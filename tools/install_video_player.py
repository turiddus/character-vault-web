"""Installa il player video interno (Qt Multimedia) nel Python privato di Character Vault.

- usa il runtime che l'app usa davvero (CV_RUNTIME_V2.json -> _runtime_v2), non uno vecchio;
- scarica da PyPI il pacchetto PySide6-Addons della STESSA versione di PySide6, verifica lo SHA-256
  pubblicato da PyPI ed estrae solo gli 11 file del player (circa 22 MB invece di 450 MB);
- verifica che il player si carichi e che esista un decoder video; se qualcosa manca indica
  ESATTAMENTE quale DLL e come rimediare (tools/qt_dll_doctor.py).
Nessuna modifica al Python di sistema. Senza player interno l'app usa il player di Windows.

uso: RUN_PYTHON.bat tools\\install_video_player.py [--diagnose]
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

PLAYER_FILE = re.compile(r"^PySide6/(QtMultimedia(Widgets)?\.pyd|Qt6Multimedia(Widgets)?\.dll|"
                         r"(avcodec|avformat|avutil|swscale|swresample)-\d+\.dll|plugins/multimedia/[^/]+\.dll)$",
                         re.IGNORECASE)
PROBE = r"""
import json, sys
out = {"import": False, "decoders": 0, "error": ""}
try:
    from PySide6.QtWidgets import QApplication
    from PySide6.QtMultimedia import QMediaPlayer, QMediaFormat
    from PySide6.QtMultimediaWidgets import QVideoWidget
    out["import"] = True
    app = QApplication.instance() or QApplication(["cv-player-check", "-platform", "offscreen"])
    out["decoders"] = len(QMediaFormat().supportedFileFormats(QMediaFormat.ConversionMode.Decode))
except Exception as exc:
    out["error"] = f"{type(exc).__name__}: {exc}"
print("CVPROBE" + json.dumps(out))
"""


def runtime() -> Path:
    """Interpreter the application really starts (CV_RUNTIME_V2.json), else the current one."""
    try:
        from cv_runtime_entry_v2 import configured_runtime
        return configured_runtime(ROOT)
    except Exception:
        return Path(sys.executable)


def environment(executable: Path) -> dict:
    try:
        from cv_runtime_entry_v2 import runtime_env
        return runtime_env(ROOT, executable, probe=True)
    except Exception:
        env = os.environ.copy()
        env["QT_QPA_PLATFORM"] = "offscreen"
        return env


def probe(executable: Path) -> dict:
    try:
        done = subprocess.run([str(executable), "-X", "utf8", "-c", PROBE], capture_output=True, text=True,
                              timeout=120, env=environment(executable), cwd=str(ROOT))
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"import": False, "decoders": 0, "error": str(exc)}
    for line in done.stdout.splitlines():
        if line.startswith("CVPROBE"):
            return json.loads(line[7:])
    return {"import": False, "decoders": 0, "error": (done.stderr or done.stdout).strip()[-600:]}


def pyside_version(executable: Path) -> str:
    code = ("import importlib.metadata as m\n"
            "for n in ('PySide6-Essentials','PySide6'):\n"
            "    try: print(m.version(n)); break\n"
            "    except m.PackageNotFoundError: pass\n"
            "else:\n"
            "    import PySide6; print(PySide6.__version__)")
    done = subprocess.run([str(executable), "-c", code], capture_output=True, text=True, timeout=60,
                          env=environment(executable))
    version = done.stdout.strip().splitlines()[-1] if done.stdout.strip() else ""
    if not re.fullmatch(r"\d+\.\d+(\.\d+)?", version):
        raise RuntimeError("versione di PySide6 non riconosciuta nel Python privato: " + (done.stderr.strip()[-300:] or "?"))
    return version


def download_wheel(version: str, folder: Path) -> Path:
    print(f"  Cerco PySide6-Addons {version} su PyPI...")
    with urllib.request.urlopen(f"https://pypi.org/pypi/PySide6-Addons/{version}/json", timeout=60) as resp:
        files = json.load(resp)["urls"]
    wheel = next((f for f in files if f["filename"].endswith("win_amd64.whl")), None)
    if wheel is None:
        raise RuntimeError(f"PyPI non ha il pacchetto Windows di PySide6-Addons {version}")
    target = folder / wheel["filename"]
    digest = hashlib.sha256()
    size = int(wheel.get("size") or 0)
    got = 0
    print(f"  Scarico {wheel['filename']} ({size / 1e6:.0f} MB)...")
    with urllib.request.urlopen(wheel["url"], timeout=120) as resp, open(target, "wb") as out:
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
            digest.update(chunk)
            got += len(chunk)
            if size and got % (16 * 1024 * 1024) < len(chunk):
                print(f"    {got * 100 // size}%")
    if digest.hexdigest() != wheel["digests"]["sha256"]:
        target.unlink(missing_ok=True)
        raise RuntimeError("download corrotto (SHA-256 diverso da quello di PyPI): riprova")
    return target


def extract_player(wheel: Path, site: Path) -> list[str]:
    written = []
    with zipfile.ZipFile(wheel) as archive:
        for info in archive.infolist():
            if info.is_dir() or not PLAYER_FILE.match(info.filename):
                continue
            target = site.joinpath(*info.filename.split("/"))
            if not target.resolve().is_relative_to(site.resolve()):
                continue
            if target.is_file() and target.stat().st_size == info.file_size:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_name(target.name + ".cvtmp")
            with archive.open(info) as source, open(temporary, "wb") as out:
                while True:
                    chunk = source.read(1024 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
            os.replace(temporary, target)
            written.append(info.filename)
    return written


def diagnose(executable: Path) -> None:
    from qt_dll_doctor import report
    print("\n  Controllo delle DLL del player:")
    report("QtMultimedia", executable.parent)


def main(argv: list[str]) -> int:
    executable = runtime()
    site = executable.parent / "Lib" / "site-packages"
    print(f"  Python di Character Vault: {executable}")
    if "--diagnose" in argv:
        print("  " + json.dumps(probe(executable)))
        diagnose(executable)
        return 0
    if not (site / "PySide6").is_dir():
        print("[ERRORE] PySide6 non trovato nel Python privato: avvia START_AND_REPAIR_CHARACTER_VAULT.bat.")
        return 2
    state = probe(executable)
    if state["import"] and state["decoders"]:
        print("  Il player video interno e' gia' installato e funzionante.")
        return 0
    if not state["import"]:
        version = pyside_version(executable)
        print(f"  PySide6 nel Python privato: {version}")
        with tempfile.TemporaryDirectory(prefix="cv_player_") as tmp:
            try:
                wheel = download_wheel(version, Path(tmp))
            except Exception as exc:
                print(f"[ERRORE] download non riuscito: {exc}")
                print("         Controlla la connessione e riprova. Nel frattempo i video si aprono col player di Windows.")
                return 3
            files = extract_player(wheel, site)
        (site / "PySide6" / "CV_VIDEO_PLAYER.json").write_text(
            json.dumps({"pyside6_addons": version, "files": files}, indent=1), encoding="utf-8")
        print(f"  Installati {len(files)} file del player.")
        state = probe(executable)
    if state["import"] and state["decoders"]:
        print("\n  FATTO: player video interno pronto. Riavvia Character Vault: in Video, Play usa il player dell'app.")
        return 0
    if state["import"]:
        print("\n[ATTENZIONE] Il player si carica ma Windows non fornisce i decoder video (Media Foundation).")
    else:
        print(f"\n[ERRORE] Il player non si carica: {state['error']}")
    diagnose(executable)
    print("\n  Finche' non e' risolto, Play apre il video con il player di Windows: nessun dato e' a rischio.")
    return 4


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
