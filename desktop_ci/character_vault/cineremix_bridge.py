"""CineRemix inside Character Vault (7.3).

* The CineRemix sources live in ``CineRemix/`` (shipped with the release, without credentials).
* Its private Python, ``_runtime_cineremix/python``, is built on request from the application's own
  embedded Python 3.11 (copied, nothing downloaded) plus the wheels listed with SHA-256 in
  ``tools/cineremix_requirements_win_cp311.lock`` (installed by pip with --require-hashes).
  It is separate from the application runtime: CineRemix keeps its own PySide6/OpenCV/OCR versions.
* Settings, YouTube sign-in, history and the export archive are CineRemix's usual user data folder
  (%LOCALAPPDATA%/CineRemix60), shared with a stand-alone CineRemix if one is installed.
* Every export CineRemix records as successful (catalog.sqlite3 → exports) is imported into the
  catalog and queued for Codex by the main window (``exports_since``).
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

from character_vault import addons

LOCK_NAME = "cineremix_requirements_win_cp311.lock"
MARKER = "CV_CINEREMIX_RUNTIME.json"
VIDEO_EXT = {".mp4", ".mkv", ".mov", ".m4v", ".webm", ".avi"}
PROBE = r"""
import json, sys
out = {"ok": False, "missing": [], "error": ""}
for name in ("PySide6.QtWidgets", "PySide6.QtMultimedia", "PySide6.QtMultimediaWidgets", "cv2", "av", "numpy",
             "scipy", "PIL", "rapidocr_onnxruntime", "onnxruntime", "yt_dlp", "google_auth_oauthlib", "imageio_ffmpeg",
             "psutil", "cineremix.gui"):
    try:
        __import__(name)
    except Exception as exc:
        out["missing"].append(f"{name}: {type(exc).__name__}: {exc}"[:300])
try:
    from PySide6.QtWidgets import QApplication
    app = QApplication.instance() or QApplication(["cv-cineremix-check", "-platform", "offscreen"])
    import imageio_ffmpeg
    out["ffmpeg"] = bool(imageio_ffmpeg.get_ffmpeg_exe())
    import yt_dlp.version
    out["yt_dlp"] = yt_dlp.version.__version__
except Exception as exc:
    out["error"] = f"{type(exc).__name__}: {exc}"[:400]
out["ok"] = not out["missing"] and not out["error"]
print("CVCR" + json.dumps(out))
"""


def cineremix_data_dir() -> Path:
    base = os.environ.get("CINEREMIX_DATA") or os.environ.get("LOCALAPPDATA") or str(Path.home() / ".cache")
    return Path(base) / "CineRemix60"


class CineRemixBridge:
    def __init__(self, base_dir: Path, data_dir: Path, app_python: Path | None = None):
        self.base_dir = Path(base_dir)
        self.data_dir = Path(data_dir)
        self.app_dir = self.base_dir / "CineRemix"
        self.runtime = self.base_dir / "_runtime_cineremix"
        self.lock = self.base_dir / "tools" / LOCK_NAME
        self.app_python = addons.python_console(app_python or sys.executable)
        self._process: subprocess.Popen | None = None

    # ------------------------------------------------------------------ state
    def python(self, windowed: bool = False) -> Path:
        override = os.environ.get("CV_CINEREMIX_PYTHON")       # tests / developer setups
        if override:
            return Path(override)
        folder = self.runtime / "python"
        if os.name == "nt":
            return folder / ("pythonw.exe" if windowed else "python.exe")
        return folder / "bin" / "python3"

    def lock_digest(self) -> str:
        try:
            return hashlib.sha256(self.lock.read_bytes()).hexdigest()
        except OSError:
            return ""

    def marker(self) -> dict:
        try:
            return json.loads((self.runtime / MARKER).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def bundled(self) -> bool:
        return (self.app_dir / "app.py").is_file() and (self.app_dir / "cineremix" / "gui.py").is_file()

    def installed(self) -> bool:
        if os.environ.get("CV_CINEREMIX_PYTHON"):
            return True
        return self.python().is_file() and bool(self.marker().get("ok"))

    def outdated(self) -> bool:
        return self.installed() and not os.environ.get("CV_CINEREMIX_PYTHON") and \
            self.marker().get("lock") != self.lock_digest()

    def running(self) -> bool:
        return bool(self._process and self._process.poll() is None)

    def status(self) -> dict:
        return {"bundled": self.bundled(), "installed": self.installed(), "outdated": self.outdated(),
                "running": self.running(), "yt_dlp": self.marker().get("yt_dlp", ""),
                "data_dir": str(cineremix_data_dir())}

    # ------------------------------------------------------------------ install
    def _env(self, python: Path, probe: bool = False) -> dict:
        env = addons.child_env()
        for key in ("QT_QPA_PLATFORM", "QT_PLUGIN_PATH", "QT_QPA_PLATFORM_PLUGIN_PATH", "QML2_IMPORT_PATH",
                    "CHARACTER_VAULT_HOME"):
            env.pop(key, None)
        plugins = Path(python).parent / "Lib" / "site-packages" / "PySide6" / "plugins"
        if plugins.is_dir():
            env["QT_PLUGIN_PATH"] = str(plugins)
            env["QT_QPA_PLATFORM_PLUGIN_PATH"] = str(plugins / "platforms")
        if probe:
            env["QT_QPA_PLATFORM"] = "offscreen"
        return env

    def probe(self, python: Path | None = None) -> dict:
        python = Path(python or self.python())
        try:
            done = subprocess.run([str(python), "-X", "utf8", "-c", PROBE], capture_output=True, text=True,
                                  encoding="utf-8", errors="replace", timeout=300, env=self._env(python, True),
                                  cwd=str(self.app_dir), creationflags=addons.FLAGS)
        except (OSError, subprocess.TimeoutExpired) as exc:
            return {"ok": False, "error": str(exc)}
        for line in done.stdout.splitlines():
            if line.startswith("CVCR"):
                return json.loads(line[4:])
        return {"ok": False, "error": (done.stderr or done.stdout).strip()[-800:]}

    def _copy_python(self, target: Path) -> None:
        """The application's embedded Python without its packages, with CineRemix on sys.path."""
        source = self.app_python.parent
        if not any(source.glob("python3*.zip")):
            raise addons.AddonError("The application's private Python was not found (run START_AND_REPAIR).")
        target.mkdir(parents=True)
        for item in source.iterdir():
            if item.name.lower() in ("lib", "scripts", "__pycache__") or item.name.endswith("._pth"):
                continue
            if item.is_dir():
                shutil.copytree(item, target / item.name)
            else:
                shutil.copy2(item, target / item.name)
        (target / "Lib" / "site-packages").mkdir(parents=True)
        archive = next(source.glob("python3*.zip")).name
        pth = next(source.glob("python3*._pth"), None)
        name = pth.name if pth else archive.replace(".zip", "._pth")
        (target / name).write_text("\n".join([archive, ".", "Lib/site-packages", str(self.app_dir.resolve()),
                                              "import site", ""]), encoding="utf-8")

    def install(self, progress: addons.Progress = addons._noop, cancel=None) -> dict:
        if os.name != "nt":
            raise addons.AddonError("The CineRemix runtime is built on Windows only.")
        if not self.bundled():
            raise addons.AddonError("The CineRemix folder is missing from this installation.")
        if self.running():
            raise addons.AddonError("Close CineRemix first.")
        if not self.lock.is_file():
            raise addons.AddonError(f"tools\\{LOCK_NAME} is missing.")
        stage = self.base_dir / f"_runtime_cineremix.new-{os.getpid()}"
        shutil.rmtree(stage, ignore_errors=True)
        try:
            progress(0.02, "Preparing CineRemix's private Python…")
            self._copy_python(stage / "python")
            pip_dir = addons.ensure_pip(self.data_dir, progress, cancel)
            progress(0.05, "Downloading CineRemix components (about 450 MB, once)…")
            addons.run_pip(stage / "python" / "python.exe", pip_dir,
                           ["install", "--no-deps", "--require-hashes", "--only-binary=:all:", "--no-warn-script-location",
                            "--no-compile", "-r", str(self.lock)], progress, cancel, timeout=7200)
            progress(0.95, "Checking CineRemix…")
            result = self.probe(stage / "python" / "python.exe")
            if not result.get("ok"):
                raise addons.AddonError("CineRemix check failed: " +
                                        "; ".join(result.get("missing") or [result.get("error", "")])[:900])
            (stage / MARKER).write_text(json.dumps({"ok": True, "lock": self.lock_digest(), "installed_at": time.time(),
                                                    "yt_dlp": result.get("yt_dlp", "")}, indent=1), encoding="utf-8")
            old = None
            if self.runtime.exists():
                old = self.base_dir / f"_runtime_cineremix.old-{int(time.time())}"
                os.replace(self.runtime, old)
            os.replace(stage, self.runtime)
            if old:
                shutil.rmtree(old, ignore_errors=True)
            addons._log(f"CineRemix runtime installed (yt-dlp {result.get('yt_dlp', '?')}).")
            return {"installed": True, "yt_dlp": result.get("yt_dlp", "")}
        except BaseException:
            shutil.rmtree(stage, ignore_errors=True)
            raise

    def update_ytdlp(self, force: bool = False) -> dict:
        """Keep CineRemix's own yt-dlp current (its Downloader tab uses it). Skipped while it runs."""
        if not self.installed() or os.environ.get("CV_CINEREMIX_PYTHON") or self.running():
            return {"skipped": True}
        marker = self.marker()
        if not force and time.time() - float(marker.get("ytdlp_check", 0) or 0) < addons.UPDATE_EVERY:
            return {"checked": False}
        latest = addons.http_json(addons.PYPI.format(name="yt-dlp"))["info"]
        version = latest["version"]
        marker["ytdlp_check"] = time.time()
        if addons.version_key(version) > addons.version_key(marker.get("yt_dlp", "0")):
            ejs = addons.YtDlpAddon._ejs_requirement(latest)
            pip_dir = addons.ensure_pip(self.data_dir)
            addons.run_pip(self.python(), pip_dir, ["install", "--upgrade", "--no-deps", "--only-binary=:all:",
                                                    "--no-warn-script-location", f"yt-dlp=={version}",
                                                    f"yt-dlp-ejs=={ejs}" if ejs else "yt-dlp-ejs"])
            marker["yt_dlp"] = version
            addons._log(f"CineRemix: yt-dlp updated to {version}.")
        (self.runtime / MARKER).write_text(json.dumps(marker, indent=1), encoding="utf-8")
        return {"yt_dlp": marker.get("yt_dlp", ""), "updated": marker.get("yt_dlp") == version}

    # ------------------------------------------------------------------ launch
    def launch(self, files: list[str] | None = None) -> int:
        if not self.installed():
            raise addons.AddonError("CineRemix is not installed yet.")
        if self.running() and files:
            # A second window would compete for the same data folder: open a new one only when idle.
            raise addons.AddonError("CineRemix is already open: add the files there, or close it and retry.")
        python = self.python(windowed=True)
        if not python.is_file():
            python = self.python()
        args = [str(python), "-X", "utf8", str(self.app_dir / "app.py")]
        existing = [str(Path(f)) for f in files or [] if Path(f).exists()]
        if existing:
            args += ["--add", *existing]
        flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)
        self._process = subprocess.Popen(args, cwd=str(self.app_dir), env=self._env(python),
                                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                         stderr=subprocess.DEVNULL, creationflags=flags)
        return self._process.pid


# ---------------------------------------------------------------------------- finished remixes

def exports_since(since: float, catalog: Path | None = None) -> list[dict]:
    """Successful CineRemix exports (newest last) recorded after ``since``; missing files are skipped."""
    path = Path(catalog or cineremix_data_dir() / "catalog.sqlite3")
    if not path.is_file():
        return []
    try:
        conn = sqlite3.connect(str(path), timeout=5)
        try:
            rows = conn.execute("SELECT output, created, payload FROM exports WHERE created > ? ORDER BY created",
                                (float(since),)).fetchall()
        finally:
            conn.close()
    except sqlite3.Error:
        return []
    found = []
    for output, created, payload in rows:
        file = Path(output or "")
        if file.suffix.lower() not in VIDEO_EXT or not file.is_file():
            continue
        try:
            report = json.loads(payload or "{}")
        except ValueError:
            report = {}
        found.append({"path": str(file), "created": float(created), "duration": report.get("duration"),
                      "youtube": (report.get("youtube") or {}).get("url", "") if isinstance(report.get("youtube"), dict) else ""})
    return found
