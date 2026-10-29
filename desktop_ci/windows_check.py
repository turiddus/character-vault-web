"""Windows check of Character Vault 7.3 add-ons, run by GitHub Actions on a clean machine.

Mirrors the user's PC: the application's embedded Python 3.11.9 (same SHA-256 as CV_RUNTIME_DOWNLOADS_V2.json),
an installation path containing "&" and spaces, and the real modules character_vault/addons.py,
ytdlp_job.py, link_download.py and cineremix_bridge.py. CineRemix itself is replaced by a stub that imports
the same libraries (the CineRemix sources are not published here).

usage: python windows_check.py <work folder>
"""
import hashlib, json, os, shutil, subprocess, sys, urllib.request, zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY_URL = "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip"
PY_SHA = "009d6bf7e3b2ddca3d784fa09f90fe54336d5b60f0e0f305c37f400bf83cfd3b"


def main():
    work = Path(sys.argv[1]).resolve()
    base = work / "Users" / "Salvatore&Annalisa" / "CharacterVault 8.2 (test)"
    shutil.rmtree(base, ignore_errors=True)
    shutil.copytree(HERE, base, ignore=shutil.ignore_patterns("windows_check.py", "__pycache__"))
    zip_path = work / "python-embed.zip"
    if not zip_path.is_file():
        urllib.request.urlretrieve(PY_URL, zip_path)
    if hashlib.sha256(zip_path.read_bytes()).hexdigest() != PY_SHA:
        raise SystemExit("embedded Python hash mismatch")
    py = base / "_runtime_v2" / "python"
    py.mkdir(parents=True)
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(py)
    (py / "Lib" / "site-packages").mkdir(parents=True)
    pth = next(py.glob("python3*._pth"))
    pth.write_text("\n".join(["python311.zip", ".", "Lib/site-packages", str(base), "import site", ""]), encoding="utf-8")
    env = {k: v for k, v in os.environ.items() if k not in ("PYTHONHOME", "PYTHONPATH")}
    done = subprocess.run([str(py / "python.exe"), "-X", "utf8", str(base / "check_inside.py")], cwd=str(base),
                          env=env, timeout=5400)
    report = base / "Data" / "ci_report.json"
    print(report.read_text(encoding="utf-8") if report.is_file() else "no report")
    sys.exit(done.returncode)


if __name__ == "__main__":
    main()
