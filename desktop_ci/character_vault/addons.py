"""Private add-ons that are downloaded on demand and kept up to date (7.3).

* pip: the official wheel from PyPI (SHA-256 checked against PyPI), extracted under Data/addons/pip.
  The private runtime has no pip of its own; this one is only used to install the add-ons below.
* yt-dlp (+ its default extras and the Deno JS runtime that YouTube now requires) in a VERSIONED
  folder Data/addons/yt-dlp/<version>-<stamp>. Sites change often, so the newest release is checked
  every few hours and installed next to the current one; ``current.json`` switches to it only after
  a probe has imported it. A running download keeps using the folder it started with.
* FFmpeg/FFprobe, only if none is installed yet (bin/ffmpeg): yt-dlp needs FFmpeg to join the
  separate video/audio streams of high-quality sources, and the desktop needs it for videos anyway.

Only the standard library is used, so the module also runs from tools/CI scripts.
Nothing here touches the private runtime itself (repairs keep working) or user data.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Callable

Progress = Callable[[float, str], None]
PYPI = "https://pypi.org/pypi/{name}/json"
FFMPEG_RELEASE = "https://api.github.com/repos/yt-dlp/FFmpeg-Builds/releases/latest"
YTDLP_SPEC = "yt-dlp[default,deno]"
UPDATE_EVERY = 6 * 3600          # yt-dlp releases often; YouTube changes break old versions
FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0)


class AddonError(RuntimeError):
    pass


def _noop(*_):
    pass


def _log(message: str) -> None:
    try:
        from character_vault.config import log
        log().info(message)
    except Exception:
        pass


# ---------------------------------------------------------------------------------------- HTTP

def http_json(url: str, timeout: float = 30) -> dict:
    request = urllib.request.Request(url, headers={"Accept": "application/json",
                                                   "User-Agent": "CharacterVault-addons"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise AddonError(f"{url.split('/')[2]} not reachable: {exc}") from exc


def download(url: str, target: Path, sha256: str, progress: Progress = _noop, cancel=None,
             label: str = "") -> Path:
    """Download to ``target`` through a .part file; refuses anything whose SHA-256 differs."""
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_file() and file_sha256(target) == sha256.lower():
        return target
    part = target.with_name(target.name + ".part")
    digest = hashlib.sha256()
    request = urllib.request.Request(url, headers={"User-Agent": "CharacterVault-addons"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response, open(part, "wb") as out:
            total = int(response.headers.get("Content-Length") or 0)
            done, last = 0, 0.0
            while True:
                if cancel and cancel():
                    raise AddonError("Canceled.")
                chunk = response.read(1 << 20)
                if not chunk:
                    break
                out.write(chunk)
                digest.update(chunk)
                done += len(chunk)
                if total and time.monotonic() - last > 0.5:
                    last = time.monotonic()
                    progress(done / total, f"{label or target.name}: {done / 1048576:.0f}/{total / 1048576:.0f} MB")
        if digest.hexdigest() != sha256.lower():
            raise AddonError(f"{target.name}: SHA-256 does not match the published value; file discarded.")
        os.replace(part, target)
        return target
    except (urllib.error.URLError, OSError) as exc:
        raise AddonError(f"Download failed ({target.name}): {exc}") from exc
    finally:
        try:
            part.unlink()
        except OSError:
            pass


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def version_key(text: str) -> tuple:
    return tuple(int(p) if p.isdigit() else 0 for p in re.split(r"[.\-+]", str(text or "0")))


def pypi_latest(name: str) -> dict:
    data = http_json(PYPI.format(name=name))
    return {"version": data["info"]["version"], "files": data.get("urls") or []}


# ---------------------------------------------------------------------------------------- pip

def python_console(executable: str | Path | None = None) -> Path:
    """python.exe next to the running interpreter (pythonw.exe has no usable stdout)."""
    exe = Path(executable or sys.executable)
    if exe.name.lower() == "pythonw.exe" and exe.with_name("python.exe").is_file():
        return exe.with_name("python.exe")
    return exe


def child_env(extra: dict | None = None) -> dict:
    env = os.environ.copy()
    for key in ("PYTHONHOME", "PYTHONPATH", "PYTHONSTARTUP", "PIP_REQUIRE_VIRTUALENV", "PIP_USER"):
        env.pop(key, None)
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
    env["PIP_NO_INPUT"] = "1"
    env.update(extra or {})
    return env


def ensure_pip(data_dir: Path, progress: Progress = _noop, cancel=None) -> Path:
    """Folder containing an extracted, verified pip (reused while it works)."""
    root = Path(data_dir) / "addons" / "pip"
    for folder in sorted(root.glob("pip-*"), key=lambda p: version_key(p.name[4:]), reverse=True):
        if (folder / "pip" / "__main__.py").is_file() and (folder / ".cv_complete").is_file():
            return folder
    progress(0.0, "Downloading pip (PyPI)…")
    latest = pypi_latest("pip")
    wheel = next((f for f in latest["files"] if f["filename"].endswith("py3-none-any.whl")), None)
    if not wheel:
        raise AddonError("No pip wheel published on PyPI.")
    cache = root / "wheels"
    path = download(wheel["url"], cache / wheel["filename"], wheel["digests"]["sha256"], progress, cancel, "pip")
    folder = root / f"pip-{latest['version']}"
    temp = root / f".pip-{latest['version']}-{os.getpid()}"
    shutil.rmtree(temp, ignore_errors=True)
    with zipfile.ZipFile(path) as archive:
        archive.extractall(temp)
    (temp / ".cv_complete").write_text(latest["version"], encoding="utf-8")
    shutil.rmtree(folder, ignore_errors=True)
    os.replace(temp, folder)
    try:
        path.unlink()
    except OSError:
        pass
    return folder


PIP_BOOT = ("import sys; sys.path.insert(0, sys.argv.pop(1)); "
            "from pip._internal.cli.main import main; sys.exit(main(sys.argv[1:]))")


def run_pip(python: Path, pip_dir: Path, args: list[str], log: Progress = _noop, cancel=None,
            timeout: float = 3600) -> str:
    """Run pip with ``python``; the output is streamed to ``log`` (fraction -1 = text only)."""
    command = [str(python_console(python)), "-X", "utf8", "-c", PIP_BOOT, str(pip_dir),
               "--disable-pip-version-check", "--no-input", *args]
    proc = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            env=child_env(), creationflags=FLAGS, text=True, encoding="utf-8", errors="replace")
    started, tail = time.monotonic(), []
    watchdog = threading.Timer(timeout, proc.kill)
    watchdog.daemon = True
    watchdog.start()
    try:
        for line in proc.stdout:
            line = line.rstrip()
            if line:
                tail.append(line)
                del tail[:-40]
                log(-1, line[:300])
            if cancel and cancel():
                proc.kill()
                raise AddonError("Canceled.")
        code = proc.wait()
    finally:
        watchdog.cancel()
    if code != 0:
        if time.monotonic() - started >= timeout:
            raise AddonError("pip did not finish in time.")
        raise AddonError("pip failed: " + " | ".join(tail[-6:])[-900:])
    return "\n".join(tail)


# ---------------------------------------------------------------------------------------- yt-dlp

class YtDlpAddon:
    """Versioned private yt-dlp. Thread-safe; installs never replace a folder in use.

    Two layers keep updates small: a *deps* folder from the last full install (requests, websockets,
    Deno ~40 MB…) and a *core* folder with only yt-dlp + yt-dlp-ejs (~3 MB) placed first on sys.path.
    A new yt-dlp release normally downloads only the core; everything is reinstalled monthly.
    """

    FULL_EVERY = 30 * 86400

    def __init__(self, data_dir: Path, python: Path | None = None, project_root: Path | None = None):
        self.data_dir = Path(data_dir)
        self.root = self.data_dir / "addons" / "yt-dlp"
        self.python = python_console(python)
        self.project_root = Path(project_root or Path(__file__).resolve().parents[1])
        self._lock = threading.RLock()
        self._active = 0

    # -------------------------------------------------- state
    def _state_file(self) -> Path:
        return self.root / "state.json"

    def state(self) -> dict:
        try:
            return json.loads(self._state_file().read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def _save_state(self, **changes) -> None:
        data = {**self.state(), **changes}
        self.root.mkdir(parents=True, exist_ok=True)
        temp = self._state_file().with_suffix(".tmp")
        temp.write_text(json.dumps(data, indent=1), encoding="utf-8")
        os.replace(temp, self._state_file())

    def _complete(self, name: str) -> dict | None:
        folder = self.root / name if name else None
        if not folder or not (folder / ".cv_complete.json").is_file():
            return None
        try:
            return json.loads((folder / ".cv_complete.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def current(self) -> dict | None:
        state = self.state()
        core, deps = state.get("current", ""), state.get("deps", "") or state.get("current", "")
        info, deps_info = self._complete(core), self._complete(deps)
        if not info or not deps_info or not (self.root / core / "yt_dlp" / "__init__.py").is_file():
            return None
        dirs = [self.root / core] + ([self.root / deps] if deps != core else [])
        return {"dir": self.root / core, "dirs": dirs, "version": info.get("yt_dlp", ""),
                "deno": bool(info.get("deno") or deps_info.get("deno")), "deps_at": deps_info.get("installed_at", 0)}

    def installed(self) -> bool:
        return self.current() is not None

    # -------------------------------------------------- usage by downloads
    def acquire(self) -> dict:
        with self._lock:
            info = self.current()
            if not info:
                raise AddonError("yt-dlp is not installed yet.")
            self._active += 1
            return info

    def release(self) -> None:
        with self._lock:
            self._active = max(0, self._active - 1)

    def worker_command(self) -> list[str]:
        return [str(self.python), "-X", "utf8", "-m", "character_vault.ytdlp_job"]

    def worker_env(self, info: dict) -> dict:
        return child_env({"CV_YTDLP_SITE": os.pathsep.join(str(d) for d in info["dirs"])})

    # -------------------------------------------------- install / update
    def probe(self, dirs: list[Path]) -> dict:
        try:
            done = subprocess.run(self.worker_command(), input=json.dumps({"probe": True}), capture_output=True,
                                  text=True, encoding="utf-8", errors="replace", timeout=180,
                                  env=child_env({"CV_YTDLP_SITE": os.pathsep.join(str(d) for d in dirs)}),
                                  cwd=str(self.project_root), creationflags=FLAGS)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise AddonError(f"yt-dlp probe failed: {exc}") from exc
        for line in done.stdout.splitlines():
            if line.startswith("CVJ "):
                event = json.loads(line[4:])
                if event.get("ev") == "probe":
                    return event
        raise AddonError("yt-dlp probe failed: " + (done.stderr or done.stdout).strip()[-600:])

    def _pip_into_new(self, args: list[str], probe_with: list[Path], progress: Progress, cancel) -> tuple[str, dict]:
        pip_dir = ensure_pip(self.data_dir, progress, cancel)
        stamp = time.strftime("%Y%m%d%H%M%S")
        temp = self.root / f".install-{stamp}-{os.getpid()}"
        shutil.rmtree(temp, ignore_errors=True)
        temp.mkdir(parents=True)
        try:
            run_pip(self.python, pip_dir, ["install", "--target", str(temp), "--upgrade", "--only-binary=:all:",
                                           "--no-warn-script-location", "--no-compile", *args], progress, cancel)
            info = self.probe([temp, *probe_with])
            deno = bool(info.get("deno")) and str(temp) in str(info.get("deno"))
            name = f"{info['version']}-{stamp}"
            (temp / ".cv_complete.json").write_text(json.dumps(
                {"yt_dlp": info["version"], "deno": deno, "installed_at": time.time()}), encoding="utf-8")
            os.replace(temp, self.root / name)
            return name, info
        except BaseException:
            shutil.rmtree(temp, ignore_errors=True)
            raise

    def install(self, version: str = "", progress: Progress = _noop, cancel=None) -> dict:
        """Full install: yt-dlp with its default extras and Deno in one new folder."""
        with self._lock:
            spec = f"{YTDLP_SPEC}=={version}" if version else YTDLP_SPEC
            progress(0.05, f"Installing {spec}…")
            name, info = self._pip_into_new([spec], [], progress, cancel)
            previous = self.state().get("current", "")
            self._save_state(current=name, deps=name, previous=previous, last_check=time.time(), last_error="")
            _log(f"yt-dlp {info['version']} installed (Deno: {'yes' if info.get('deno') else 'no'}).")
            self.prune()
            return {"installed": info["version"], "deno": bool(info.get("deno")), "full": True}

    def install_core(self, version: str, ejs: str = "", progress: Progress = _noop, cancel=None) -> dict:
        """Only yt-dlp (+ the matching yt-dlp-ejs) in a new folder; dependencies are reused."""
        with self._lock:
            current = self.current()
            if not current:
                return self.install(version, progress, cancel)
            deps = current["dirs"][-1]
            args = ["--no-deps", f"yt-dlp=={version}"] + ([f"yt-dlp-ejs=={ejs}"] if ejs else ["yt-dlp-ejs"])
            progress(0.05, f"Updating yt-dlp to {version}…")
            name, info = self._pip_into_new(args, [deps], progress, cancel)
            self._save_state(current=name, previous=self.state().get("current", ""), last_check=time.time(),
                             last_error="")
            _log(f"yt-dlp updated to {info['version']}.")
            self.prune()
            return {"installed": info["version"], "full": False}

    def prune(self) -> None:
        """Remove folders other than current/previous/deps; skipped while a download runs."""
        with self._lock:
            if self._active:
                return
            state = self.state()
            keep = {state.get("current", ""), state.get("previous", ""), state.get("deps", "")}
            for folder in self.root.iterdir() if self.root.is_dir() else []:
                if folder.is_dir() and folder.name not in keep:
                    shutil.rmtree(folder, ignore_errors=True)

    @staticmethod
    def _ejs_requirement(info: dict) -> str:
        for item in info.get("requires_dist") or []:
            match = re.match(r"^yt-dlp-ejs\s*==\s*([\w.]+)", item.strip())
            if match:
                return match.group(1)
        return ""

    def latest(self) -> dict:
        data = http_json(PYPI.format(name="yt-dlp"))
        return {"version": data["info"]["version"], "ejs": self._ejs_requirement(data["info"])}

    def latest_version(self) -> str:
        return self.latest()["version"]

    def ensure(self, progress: Progress = _noop, cancel=None) -> dict:
        info = self.current()
        if info:
            return {"installed": info["version"], "already": True}
        return self.install(progress=progress, cancel=cancel)

    def update(self, force: bool = False, progress: Progress = _noop, cancel=None) -> dict:
        """Install the newest yt-dlp when a newer one exists (checked at most every UPDATE_EVERY s)."""
        with self._lock:
            state = self.state()
            info = self.current()
            if not info:
                return self.install(progress=progress, cancel=cancel)
            if not force and time.time() - float(state.get("last_check", 0) or 0) < UPDATE_EVERY:
                return {"current": info["version"], "checked": False}
            try:
                latest = self.latest()
            except AddonError as exc:
                self._save_state(last_error=str(exc))
                return {"current": info["version"], "error": str(exc)}
            self._save_state(last_check=time.time(), latest=latest["version"])
            stale_deps = time.time() - float(info.get("deps_at") or 0) > self.FULL_EVERY
            if version_key(latest["version"]) <= version_key(info["version"]) and not stale_deps:
                return {"current": info["version"], "latest": latest["version"], "updated": False}
            if stale_deps:
                result = self.install(latest["version"], progress, cancel)
            else:
                result = self.install_core(latest["version"], latest["ejs"], progress, cancel)
            return {"current": result["installed"], "previous": info["version"], "updated": True,
                    "full": result.get("full", False)}


# ---------------------------------------------------------------------------------------- FFmpeg

def find_ffmpeg(base_dir: Path) -> dict:
    """Same search order as character_vault.video.binary: env, bin/ffmpeg, bin, tools/ffmpeg/bin, PATH."""
    found = {}
    for name in ("ffmpeg", "ffprobe"):
        exe = name + (".exe" if os.name == "nt" else "")
        override = os.environ.get("CHARACTER_VAULT_" + name.upper())
        base = Path(base_dir)
        for candidate in ([override] if override else []) + [base / "bin" / "ffmpeg" / exe, base / "bin" / exe,
                                                             base / "tools" / "ffmpeg" / "bin" / exe,
                                                             shutil.which(name)]:
            if candidate and Path(candidate).is_file():
                found[name] = str(Path(candidate).resolve())
                break
    return found


def _pick_ffmpeg_asset(assets: list[dict]) -> dict | None:
    """Prefer the newest release-branch static GPL build (ffmpeg-n7.1-latest-win64-gpl-7.1.zip)."""
    pattern = re.compile(r"^ffmpeg-n(\d+(?:\.\d+)*)-latest-win64-gpl-[\d.]+\.zip$")
    release = sorted(((version_key(m.group(1)), a) for a in assets if (m := pattern.match(a.get("name", "")))),
                     key=lambda pair: pair[0], reverse=True)
    if release:
        return release[0][1]
    return next((a for a in assets if a.get("name") == "ffmpeg-master-latest-win64-gpl.zip"), None)


def ensure_ffmpeg(base_dir: Path, data_dir: Path | None = None, progress: Progress = _noop, cancel=None,
                  release_url: str = FFMPEG_RELEASE, windows_build: bool | None = None) -> dict:
    """Install FFmpeg + FFprobe into bin/ffmpeg when none is present (Windows x64 builds used by yt-dlp)."""
    found = find_ffmpeg(base_dir)
    if "ffmpeg" in found and "ffprobe" in found:
        return {**found, "installed": False}
    if not (os.name == "nt" if windows_build is None else windows_build):
        raise AddonError("FFmpeg/FFprobe not found: install them with the system package manager.")
    release = http_json(release_url)
    assets = release.get("assets") or []
    asset = _pick_ffmpeg_asset(assets)
    sums = next((a for a in assets if a.get("name") == "checksums.sha256"), None)
    if not asset or not sums:
        raise AddonError("No verifiable FFmpeg build found; place ffmpeg.exe and ffprobe.exe in bin\\ffmpeg.")
    request = urllib.request.Request(sums["browser_download_url"], headers={"User-Agent": "CharacterVault-addons"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            listing = response.read().decode("utf-8", "replace")
    except (urllib.error.URLError, OSError) as exc:
        raise AddonError(f"FFmpeg checksums not reachable: {exc}") from exc
    expected = next((line.split()[0] for line in listing.splitlines()
                     if line.strip().endswith(asset["name"]) and re.match(r"^[0-9a-f]{64}\s", line)), "")
    if not expected:
        raise AddonError(f"{asset['name']} is not listed in checksums.sha256; nothing installed.")
    work = Path(data_dir or Path(base_dir) / "Data") / "addons" / "ffmpeg"
    archive = download(asset["browser_download_url"], work / asset["name"], expected, progress, cancel, "FFmpeg")
    target = Path(base_dir) / "bin" / "ffmpeg"
    target.mkdir(parents=True, exist_ok=True)
    wanted = {"ffmpeg.exe", "ffprobe.exe"}
    with zipfile.ZipFile(archive) as zf:
        members = [m for m in zf.namelist() if Path(m).name.lower() in wanted and "/bin/" in m.replace("\\", "/")]
        if {Path(m).name.lower() for m in members} != wanted:
            raise AddonError("The FFmpeg archive does not contain ffmpeg.exe and ffprobe.exe.")
        for member in members:
            out = target / Path(member).name.lower()
            temp = out.with_suffix(".exe.part")
            with zf.open(member) as src, open(temp, "wb") as dst:
                shutil.copyfileobj(src, dst, 1 << 20)
            os.replace(temp, out)
    try:
        archive.unlink()
    except OSError:
        pass
    found = find_ffmpeg(base_dir)
    try:
        version = subprocess.run([found["ffmpeg"], "-hide_banner", "-version"], capture_output=True, text=True,
                                 timeout=60, creationflags=FLAGS).stdout.splitlines()[0]
    except (OSError, KeyError, IndexError, subprocess.TimeoutExpired) as exc:
        raise AddonError(f"The installed FFmpeg does not start: {exc}") from exc
    _log(f"FFmpeg installed in bin\\ffmpeg ({version}).")
    return {**found, "installed": True, "version": version}
