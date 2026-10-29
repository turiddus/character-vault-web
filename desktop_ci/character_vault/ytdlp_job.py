"""One link download, run as a separate process with the private yt-dlp (7.3).

    python -X utf8 -m character_vault.ytdlp_job  < spec.json

The spec arrives on stdin; events are written to stdout as lines ``CVJ {json}``:
probe, progress, file, log, error, done. Running yt-dlp in its own process keeps the desktop
responsive, lets a download be canceled by ending the process and allows yt-dlp to be updated while
the application is open. Only the standard library and yt-dlp are imported here.

Behaviour adapted from CineRemix 3.0.6 (universal downloader): whole video at the chosen maximum
quality, never trimmed or re-encoded (separate streams are only remuxed by FFmpeg), RedNote /
Xiaohongshu links normalised, and local cookies tried only when a site asks for a login/anti-bot check.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlparse, urlunparse

URL_RE = re.compile(r"https?://[^\s<>\"']+", re.I)
XHS_ID_RE = re.compile(r"(?<![0-9a-f])([0-9a-f]{24})(?![0-9a-f])", re.I)
MAX_ITEMS = 10          # carousels/playlists: at most 10 videos per link


def emit(ev: str, **data) -> None:
    sys.stdout.write("CVJ " + json.dumps({"ev": ev, **data}, ensure_ascii=False, default=str) + "\n")
    sys.stdout.flush()


# ------------------------------------------------------------------------------- links

def extract_url(value: str) -> str:
    """A raw URL or pasted share text ("Look at this! https://…") → the first http(s) URL."""
    text = (value or "").strip()
    match = URL_RE.search(text)
    url = match.group(0).rstrip(".,);]}>。，") if match else text
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("No http/https link found.")
    return url


def _host(url: str) -> str:
    return (urlparse(url).hostname or "").lower().rstrip(".")


def _xhs_canonical(url: str) -> str:
    """rednote.com aliases → the xiaohongshu.com form understood by yt-dlp's extractor."""
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower().rstrip(".")
    if host.endswith("rednote.com"):
        path = parsed.path
        if not (path.startswith("/explore/") or path.startswith("/discovery/item/")):
            match = XHS_ID_RE.search(path)
            if match:
                path = "/explore/" + match.group(1)
        return urlunparse((parsed.scheme or "https", "www.xiaohongshu.com", path, "", parsed.query, ""))
    return url


def normalize_url(value: str, resolve_short=None) -> tuple[str, str]:
    url = extract_url(value)
    host = _host(url)
    if host.endswith("xhslink.com") and resolve_short:
        try:
            url = resolve_short(url) or url
        except Exception:
            pass
    effective = _xhs_canonical(url)
    return effective, ("RedNote/Xiaohongshu link normalized" if effective != extract_url(value) else "")


def _resolve_redirect(url: str) -> str:
    import urllib.request
    request = urllib.request.Request(url, headers={"User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36")})
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.geturl()


def quality_format(preset: str) -> str:
    preset = (preset or "max").lower()
    heights = {"4k": 2160, "2160p": 2160, "1440p": 1440, "1080p": 1080, "720p": 720, "480p": 480}
    if preset in heights:
        h = heights[preset]
        return f"bestvideo*[height<={h}]+bestaudio/best[height<={h}]/best"
    return "bestvideo*+bestaudio/best"


def classify(text: str) -> str:
    low = str(text or "").lower().replace("’", "'")
    rules = (
        ("cancelled", ("canceled", "cancelled")),
        ("unsupported", ("unsupported url", "no video formats found", "no video could be found")),
        ("live", ("is live", "live event", "premieres in", "this live stream", "is_live")),
        ("too_big", ("larger than max-filesize", "file is larger than")),
        ("unavailable", ("private video", "video unavailable", "has been removed", "not available in your country",
                         "this video is not available", "http error 404", "account has been terminated",
                         "does not exist", "has been deleted")),
        ("auth", ("sign in", "log in", "login", "cookie", "not a bot", "captcha", "verification", "age-restricted",
                  "http error 429", "too many requests", "visitor data", "authentication", "access denied",
                  "members-only", "join this channel")),
        ("ffmpeg", ("ffmpeg", "ffprobe", "postprocessing")),
        ("network", ("timed out", "timeout", "connection", "temporary failure", "name resolution", "getaddrinfo",
                     "network is unreachable", "ssl", "remote end closed")),
        ("extractor", ("unable to extract", "nsig", "signature", "please report this issue", "out of date",
                       "requested format is not available", "http error 403", "forbidden",
                       "unable to download webpage", "jsinterp", "challenge")),
    )
    for kind, markers in rules:
        if any(m in low for m in markers):
            return kind
    return "other"


def should_try_cookies(text: str) -> bool:
    low = str(text or "").lower().replace("’", "'")
    if "unsupported url" in low:
        return False
    return any(m in low for m in ("sign in", "login", "log in", "cookie", "captcha", "not a bot", "verification",
                                  "http error 403", "http error 429", "forbidden", "too many requests",
                                  "visitor data", "private video", "authentication", "access denied",
                                  "unable to extract initial state", "age-restricted"))


# ------------------------------------------------------------------------------- cookies

def _chromium_last_profile(user_data: Path) -> str | None:
    try:
        data = json.loads((user_data / "Local State").read_text(encoding="utf-8"))
        value = (data.get("profile") or {}).get("last_used")
        return str(value) if value else None
    except (OSError, ValueError, TypeError, AttributeError):
        return None


def browser_cookie_sources() -> list[tuple[str, tuple]]:
    """Locally installed browsers, most recently used Chromium profile first (read locally by yt-dlp)."""
    forced = os.environ.get("CV_YTDLP_BROWSER", "").strip().lower()
    forced = {"google chrome": "chrome", "msedge": "edge", "microsoft edge": "edge"}.get(forced, forced)
    if forced in {"none", "off", "disabled", "0"}:
        return []
    if forced:
        return [(forced.title(), (forced,))]
    sources: list[tuple[str, tuple]] = []
    if os.name == "nt":
        local = Path(os.environ["LOCALAPPDATA"]) if os.environ.get("LOCALAPPDATA") else None
        roaming = Path(os.environ["APPDATA"]) if os.environ.get("APPDATA") else None
        if roaming and (roaming / "Mozilla" / "Firefox" / "Profiles").is_dir():
            sources.append(("Firefox", ("firefox",)))      # Chrome 127+ cookies are often not readable
        for label, browser, rel in (("Edge", "edge", ("Microsoft", "Edge", "User Data")),
                                    ("Chrome", "chrome", ("Google", "Chrome", "User Data")),
                                    ("Brave", "brave", ("BraveSoftware", "Brave-Browser", "User Data")),
                                    ("Vivaldi", "vivaldi", ("Vivaldi", "User Data"))):
            user_data = local.joinpath(*rel) if local else None
            if user_data and user_data.is_dir():
                profile = _chromium_last_profile(user_data)
                sources.append((label, (browser, profile) if profile else (browser,)))
        if roaming and (roaming / "Opera Software").is_dir():
            sources.append(("Opera", ("opera",)))
    else:
        home = Path.home()
        for label, browser, path in (("Firefox", "firefox", home / ".mozilla" / "firefox"),
                                     ("Chrome", "chrome", home / ".config" / "google-chrome"),
                                     ("Chromium", "chromium", home / ".config" / "chromium")):
            if path.exists():
                sources.append((label, (browser,)))
    return sources


def cookie_attempts(cookie_files: list[str]) -> list[tuple[str, dict]]:
    attempts: list[tuple[str, dict]] = [("without cookies", {})]
    for path in cookie_files or []:
        if Path(path).is_file():
            attempts.append((f"cookie file {Path(path).name}", {"cookiefile": str(path)}))
    attempts.extend((f"{label} cookies", {"cookiesfrombrowser": source}) for label, source in browser_cookie_sources())
    return attempts


# ------------------------------------------------------------------------------- yt-dlp

def setup_path() -> None:
    for folder in reversed([p for p in os.environ.get("CV_YTDLP_SITE", "").split(os.pathsep) if p]):
        if folder not in sys.path:
            sys.path.insert(0, folder)
        bin_dir = Path(folder) / "bin"            # pip --target puts deno.exe here
        if bin_dir.is_dir():
            os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ.get("PATH", "")


def find_deno() -> str:
    try:
        import deno  # type: ignore
        path = Path(deno.find_deno_bin())
        if path.is_file():
            return str(path)
    except Exception:
        pass
    for folder in [p for p in os.environ.get("CV_YTDLP_SITE", "").split(os.pathsep) if p]:
        for candidate in (Path(folder) / "bin" / "deno.exe", Path(folder) / "bin" / "deno",
                          Path(folder) / "deno" / "bin" / "deno.exe", Path(folder) / "deno" / "bin" / "deno"):
            if candidate.is_file():
                return str(candidate)
    import shutil
    return shutil.which("deno") or ""


class Logger:
    def __init__(self):
        self.last_error = ""

    def debug(self, message):
        text = str(message or "")
        if text.startswith("[download]") or not text.strip():
            return
        if any(k in text.lower() for k in ("[merger]", "[fixup", "[movefiles]", "[videoconvertor]", "[metadata")):
            emit("log", level="info", msg=text[:300])

    def info(self, message):
        self.debug(message)

    def warning(self, message):
        emit("log", level="warning", msg=str(message)[:400])

    def error(self, message):
        self.last_error = str(message)
        emit("log", level="error", msg=str(message)[:600])


def run(spec: dict) -> int:
    import yt_dlp  # noqa: F401  (imported after setup_path)
    from yt_dlp.postprocessor.common import PostProcessor
    from yt_dlp.utils import match_filter_func

    original = spec["url"]
    url, note = normalize_url(original, _resolve_redirect if spec.get("resolve_short", True) else None)
    if note:
        emit("log", level="info", msg=note)
    work = Path(spec["work_dir"])
    work.mkdir(parents=True, exist_ok=True)
    files: list[dict] = []

    class Collect(PostProcessor):
        def run(self, info):
            path = info.get("filepath") or info.get("_filename")
            if path and Path(path).is_file():
                files.append({"path": str(Path(path).resolve()), "title": info.get("title") or Path(path).stem,
                              "id": info.get("id") or "", "url": info.get("webpage_url") or url,
                              "uploader": info.get("uploader") or info.get("channel") or info.get("creator") or "",
                              "duration": info.get("duration"), "extractor": info.get("extractor_key") or "",
                              "width": info.get("width"), "height": info.get("height"),
                              "description": (info.get("description") or "")[:1500]})
                emit("file", **files[-1])
            return [], info

    state = {"last": 0.0, "parts": {}, "title": ""}

    def hook(data):
        info = data.get("info_dict") or {}
        title = info.get("title") or ""
        if title and title != state["title"]:
            state["title"] = title
            state["parts"] = {}
            emit("info", title=title, extractor=info.get("extractor_key") or "", id=info.get("id") or "",
                 index=info.get("playlist_index") or 1, count=info.get("n_entries") or info.get("playlist_count") or 1)
        parts = max(1, len(info.get("requested_formats") or []) or 1)
        name = data.get("filename") or data.get("tmpfilename") or ""
        if data.get("status") == "downloading":
            done = int(data.get("downloaded_bytes") or 0)
            total = int(data.get("total_bytes") or data.get("total_bytes_estimate") or 0)
            state["parts"][name] = min(1.0, done / total) if total else state["parts"].get(name, 0.0)
        elif data.get("status") == "finished":
            state["parts"][name] = 1.0
        now = time.monotonic()
        if now - state["last"] < 0.6 and data.get("status") != "finished":
            return
        state["last"] = now
        fraction = min(0.99, sum(state["parts"].values()) / parts)
        speed = data.get("speed")
        eta = data.get("eta")
        bits = [f"{fraction * 100:.0f}%"]
        if speed:
            bits.append(f"{float(speed) / 1048576:.1f} MB/s")
        if isinstance(eta, (int, float)):
            bits.append(f"ETA {int(eta)} s")
        emit("progress", f=round(fraction, 4), msg=" · ".join(bits))

    def pp_hook(data):
        if data.get("status") == "started" and data.get("postprocessor") in ("Merger", "FixupM3u8", "VideoRemuxer"):
            emit("progress", f=0.995, msg="Joining video and audio (no re-encoding)")

    logger = Logger()
    options = {
        "format": quality_format(spec.get("quality", "max")),
        "format_sort": ["res", "fps", "ext:mp4:m4a"],      # same resolution: prefer MP4/M4A (plays everywhere)
        "merge_output_format": "mp4/mkv",
        "outtmpl": {"default": "%(title).150B [%(id)s].%(ext)s"},
        "paths": {"home": str(work), "temp": str(work / ".tmp")},
        "noplaylist": True,
        "playlist_items": f"1:{MAX_ITEMS}",
        "windowsfilenames": os.name == "nt",
        "continuedl": True,
        "retries": 10,
        "fragment_retries": 10,
        "extractor_retries": 3,
        "concurrent_fragment_downloads": 4,
        "overwrites": False,
        "updatetime": False,
        "quiet": True,
        "no_warnings": False,
        "noprogress": True,
        "logger": logger,
        "progress_hooks": [hook],
        "postprocessor_hooks": [pp_hook],
        "match_filter": match_filter_func("!is_live"),
    }
    if spec.get("ffmpeg"):
        options["ffmpeg_location"] = spec["ffmpeg"]
    if spec.get("max_bytes"):
        options["max_filesize"] = int(spec["max_bytes"])
    deno = find_deno()
    if deno:
        options["js_runtimes"] = {"deno": {"path": deno}}
    attempts = cookie_attempts(spec.get("cookie_files") or [])
    if spec.get("no_cookies"):
        attempts = attempts[:1]
    first_error = None
    for index, (label, auth) in enumerate(attempts):
        if index:
            emit("progress", f=0.0, msg=f"The site asks for a login/anti-bot check: retrying with {label}")
            time.sleep(0.6)
        current = {**options, **auth}
        try:
            with yt_dlp.YoutubeDL(current) as ydl:
                ydl.add_post_processor(Collect(), when="after_move")
                info = ydl.extract_info(url, download=True)
            if not files:
                skipped = (info or {}).get("is_live") or any((e or {}).get("is_live") for e in (info or {}).get("entries") or [])
                message = ("Live streams cannot be downloaded while they are on air." if skipped
                           else "The link did not produce a video file.")
                emit("error", kind="live" if skipped else "unsupported", msg=message)
                return 3
            emit("done", files=len(files), auth=label if index else "")
            return 0
        except Exception as exc:     # yt-dlp raises DownloadError/ExtractorError with readable text
            text = re.sub(r"\x1b\[[0-9;]*m", "", str(exc) or logger.last_error)
            if files:            # some items of a carousel were saved: keep them
                emit("log", level="warning", msg=text[:400])
                emit("done", files=len(files), partial=True)
                return 0
            if first_error is None:
                first_error = text
                if len(attempts) <= 1 or not should_try_cookies(text):
                    emit("error", kind=classify(text), msg=text[:900])
                    return 2
            continue
    emit("error", kind="auth", msg=("The site refused every attempt, including the local browser cookies. "
                                    "Open the video in your browser while signed in, then retry. "
                                    f"Detail: {(first_error or '')[:600]}"))
    return 2


def main() -> int:
    setup_path()
    raw = sys.stdin.read() if not sys.stdin.isatty() else "{}"
    spec = json.loads(raw or "{}")
    if spec.get("probe"):
        try:
            import yt_dlp
            from yt_dlp.version import __version__
        except Exception as exc:
            emit("error", kind="missing", msg=f"yt-dlp not importable: {exc}")
            return 4
        emit("probe", version=__version__, deno=find_deno(), path=str(Path(yt_dlp.__file__).parent))
        return 0
    try:
        return run(spec)
    except ValueError as exc:
        emit("error", kind="bad_link", msg=str(exc))
        return 2
    except ImportError as exc:
        emit("error", kind="missing", msg=f"yt-dlp not importable: {exc}")
        return 4


if __name__ == "__main__":
    sys.exit(main())
