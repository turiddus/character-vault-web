"""Validate a complete source release, or install it into a closed existing app.

No runtime, model weights, credentials, user media or catalog rows are replaced.
Source integrity is checked before creating a backup or changing the target.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import shutil
import sqlite3
import tempfile
from datetime import datetime

ROOT = Path(__file__).resolve().parent
VERSION = "9.0.8"
MANIFEST = "SOURCE_MANIFEST_SHA256.json"
SUPPORTED = {"5.0.3", "5.1.0", "5.2.0", "5.2.1", "6.0.0", "6.0.1", "6.0.2", "6.0.3", "6.0.4", "6.0.5", "6.0.6", "6.0.7", "6.0.8", "6.0.9", "6.0.10", "6.0.11", "7.0.0-preview.1", "7.0.0-ultimate-rc1", "7.0.0-ultimate-adaptive-rc2", "7.0.0-ultimate-adaptive-rc2.3-safe-shutdown", "7.0.0-ultimate-adaptive-rc2.6-mobile-sync-release-watch", "7.0.0-ultimate-adaptive-rc2.7-bidirectional-remote-log", "7.0.0-ultimate-adaptive-rc2.7.3-sync-root-cause", "7.0.0-ultimate-adaptive-rc2.7.3-notebook-sync", "7.0.0-ultimate-adaptive-rc2.7.4-core-no-agents", "7.0.0-ultimate-adaptive-rc2.7.5-core-original-recovery", "7.0.0-ultimate-adaptive-rc2.7.6-clean-exit-no-agents", "7.0.0-ultimate-adaptive-rc2.7.7-original-first-no-agents", "7.0.0-ultimate-adaptive-rc2.7.8-legacy-mobile-sync-no-agents", "7.1.0", "7.2.0", "8.0.0-genesis", "8.1.0-genesis-mobile", "8.2.0", "8.2.1", "8.2.2", "8.3.0", "9.0.0", "9.0.1", "9.0.2", "9.0.3", "9.0.4", "9.0.5", "9.0.6", "9.0.7", VERSION}
PROTECTED = {"data", "library", "libreria", "downloads", "genesisinbox", "_runtime", "_runtime_v2", "_runtime_cineremix", ".venv", ".git", "credentials"}
# One-off hotfix installers and notes accumulated by RC2.7.x and older releases. After a
# successful update they are MOVED (never deleted) into this update's backup folder,
# under retired_files/, so the installation folder shows only current launchers and guides.
RETIRED = (
    "INSTALLA_RC274_CORE_NO_AGENTS.bat", "INSTALLA_RC275_CORE_ORIGINAL_RECOVERY.bat", "INSTALLA_RC276_CLEAN_EXIT.bat",
    "INSTALLA_RC277_ORIGINAL_FIRST.bat", "INSTALLA_RC278_SYNC_611.bat", "APPLICA_RC278_SYNC_611.bat",
    "INSTALLA_MASTER_NOTEBOOK_RC273.bat", "INSTALLA_NOTEBOOK_WRITER_AUTO_OWNER.bat", "BUILD_ANDROID_RELEASE_611.bat",
    "COMPILA_APK_ANDROID.bat", "ANDROID_PREVIEW_STATS_FIX_GUIDA_IT.md", "ANDROID_UPLOAD_FOLDER_FIX_IT.md",
    "AUDIT_PATCH_PROVENANCE.json", "AUDIT_REPORT.md", "AUDIT_TEST_RESULTS.md", "AUTO_OWNER_AND_RELEASE_GUIDE_IT.md",
    "CHARACTER_VAULT_7_ULTIMATE_ADAPTIVE_GUIDA_IT.md", "CHARACTER_VAULT_7_ULTIMATE_RC1_GUIDA_IT.md",
    "CHARACTER_VAULT_RC2_7_BIDIRECTIONAL_AND_LIVE_LOG_IT.md", "CHARACTER_VAULT_V7_PREVIEW_GUIDE_IT.md",
    "CODEX_WINDOWS_PATH_HOTFIX_GUIDA_IT.txt", "CONFRONTO_ANDROID_SYNC_611_RC278.md", "EVOLUTION_SHADOW_README_IT.md",
    "FIX_ANDROID_BUILD_CRLF_606_IT.txt", "FIX_ANDROID_GALLERY_607_IT.txt", "FIX_ANDROID_SIGNING_606_IT.txt",
    "FIX_GALLERY_ANDROID_606_IT.txt", "FIX_SIGNING_GRADLE_606_IT.txt", "LEGGIMI_MASTER.txt",
    "LEGGIMI_NOTA_RC274_NO_AGENTS.md", "LEGGIMI_NOTEBOOK_WRITER_AUTO_OWNER.md", "LEGGIMI_PATHFIX2_RC274.md",
    "LEGGIMI_PATHFIX_RC274.md", "LEGGIMI_PER_ESPERTO_IT.md", "LEGGIMI_PRIMA_NOTEBOOK_RC273.md",
    "LEGGIMI_RC275_ORIGINALI_ANDROID_IT.md", "LEGGIMI_RC276_CHIUSURA_PULITA.md", "LEGGIMI_RC277_PRIORITA_ORIGINALI.md",
    "LEGGIMI_RC278_ANDROID_SYNC_611_IT.md", "RC273_TECHNICAL_AUDIT.md", "RELEASE_WRITER_NOTEBOOK.txt",
    "UPDATE_VISUAL_STATS_PRO_GUIDA_IT.md", "VISION_GUIDE.md", "LEGGIMI.txt", "LEGGIMI_ANDROID.txt",
    "LEGGIMI_ARCHIVIO_DRIVE_4.2.txt", "LEGGIMI_ATLANTE_4.0.txt", "LEGGIMI_CATEGORIE_V5.md",
    "LEGGIMI_GALLERIA_LIVE_3.1.1.txt", "LEGGIMI_GOOGLE_DRIVE_4.1.1.txt", "LEGGIMI_MEDIUM_CLOSEUP_V5.txt",
    "LEGGIMI_PRESTAZIONI_4.1.txt", "LEGGIMI_RITAGLI_V4.txt", "LEGGIMI_UNIVERSALE_3.1.txt", "LEGGIMI_VIDEO_V5.md",
    "LEGGIMI_WEB_APP_SMARTPHONE_4.3.txt", "ANALISI_E_AGGIORNAMENTO_V5.md", "AUDIT.md", "CATALOGO_CATEGORIE_V5.md",
    "MANIFEST_SHA256.txt",
    # 8.0/8.1 Genesis guides at the top level: their content is now in docs/GENESIS_IT.md
    "GENESIS_GUIDA_IT.md", "GENESIS_MOBILE_GUIDA_IT.md",
)


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def safe_path(root: Path, name: str) -> Path:
    """Use the same portable path rules when testing on Linux and Windows."""
    if not isinstance(name, str) or not name or "\\" in name or ":" in name or "\x00" in name:
        raise ValueError("Unsafe manifest path: " + repr(name))
    rel = PurePosixPath(name)
    if rel.is_absolute() or PureWindowsPath(name).drive or any(p in ("", ".", "..") for p in name.split("/")):
        raise ValueError("Unsafe manifest path: " + name)
    blocked_names = {"keystore.properties", "local.properties", "gradle.properties", "google-services.json", "client_secret.json", "token.json", "credentials.json"}
    if rel.name.casefold() in blocked_names or rel.suffix.casefold() in {".jks", ".keystore", ".p12", ".pfx", ".pem", ".env"}:
        raise ValueError("Protected signing/credential file: " + name)
    if rel.parts[0].casefold() in PROTECTED:
        raise ValueError("Protected user-data path: " + name)
    if rel.parts[0].casefold() == "models" and name not in {"models/MODELS.json", "models/geo_countries_en.json"}:
        raise ValueError("Model weights are excluded from updates: " + name)
    candidate = root.joinpath(*rel.parts)
    for ancestor in (candidate, *candidate.parents):
        if ancestor == root:
            break
        if ancestor.is_symlink():
            raise ValueError("Symlink is not allowed in an update path: " + name)
    if not candidate.resolve().is_relative_to(root.resolve()):
        raise ValueError("Update path escapes the selected installation: " + name)
    return candidate


def verified_files(payload: Path) -> list[str]:
    payload = Path(payload).resolve()
    data = json.loads((payload / MANIFEST).read_text(encoding="utf8"))
    if not isinstance(data, dict) or not data or len(data) > 10000:
        raise ValueError("Invalid source manifest")
    for name, digest in data.items():
        path = safe_path(payload, name)
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError("Invalid SHA-256 digest: " + name)
        if not path.is_file() or sha256(path) != digest:
            raise ValueError("Missing or modified source file: " + name)
        if path.suffix == ".py":
            ast.parse(path.read_text(encoding="utf8"), filename=name, feature_version=(3, 11))
    if not {"main.py", "character_vault/__init__.py"} <= set(data):
        raise ValueError("The manifest does not contain the application entry points")
    return sorted(data)


def snapshot_database(path: Path, folder: Path) -> bool:
    if not path.is_file():
        return False
    source = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    dest = sqlite3.connect(folder / "catalog_before_update.sqlite3")
    try:
        source.backup(dest)
        if dest.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise RuntimeError("SQLite backup integrity verification failed")
    finally:
        dest.close()
        source.close()
    return True


def _atomic_copy(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".cv_update_", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as out, source.open("rb") as inp:
            shutil.copyfileobj(inp, out)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)


def retire_obsolete(root: Path, backup: Path, current: set[str]) -> list[str]:
    """Move superseded root-level hotfix files into the backup folder (reversible, never deleted)."""
    moved = []
    for name in RETIRED:
        source = root / name
        if name in current or not source.is_file() or source.is_symlink():
            continue
        target = backup / "retired_files" / name
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source), str(target))
            moved.append(name)
        except OSError:
            pass   # a file open in an editor simply stays where it is
    return moved


def install(root: Path, payload: Path = ROOT) -> Path:
    root, payload = Path(root).resolve(), Path(payload).resolve()
    if root == payload:
        raise ValueError("Keep the new source folder separate from the existing installation. Use --verify for a fresh copy.")
    files = verified_files(payload) + [MANIFEST]
    for name in files:
        safe_path(root, name)
    if not (root / "main.py").is_file():
        raise ValueError("The target is not a Character Vault installation (main.py is missing)")
    version_file = root / "character_vault/__init__.py"
    match = re.search(r'__version__\s*=\s*[\'"]([^\'"]+)', version_file.read_text(encoding="utf8"))
    if not match or match.group(1) not in SUPPORTED:
        raise ValueError("Unsupported target version")
    for part in (root / "Data", root / "Data/backups", root / "Data/backups/updates"):
        if part.is_symlink():
            raise ValueError("Linked backup folders are not supported; choose an installation with local backups")
    backup = root / "Data/backups/updates" / ("v" + VERSION.replace(".", "_") + "_" + datetime.now().strftime("%Y%m%d_%H%M%S_%f"))
    backup.mkdir(parents=True)
    previous = backup / "previous_code"
    previous.mkdir()
    existing, installed = {}, []
    try:
        snapshot_database(root / "Data/db/character_vault.sqlite3", backup)
        for name in files:
            target = safe_path(root, name)
            existing[name] = target.is_file()
            if existing[name]:
                saved = previous / name
                saved.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(target, saved)
        for name in files:
            _atomic_copy(safe_path(payload, name), safe_path(root, name))
            installed.append(name)
        # 9.1: read every installed file back; a file truncated or blocked during the copy (antivirus, open app)
        # rolls the whole update back instead of leaving a broken installation.
        digests = json.loads((payload / MANIFEST).read_text(encoding="utf8"))
        for name in files:
            if name in digests and sha256(safe_path(root, name)) != digests[name]:
                raise RuntimeError("Installed file failed verification (check that Character Vault is closed): " + name)
        retired = retire_obsolete(root, backup, set(files))
        (backup / "result.json").write_text(json.dumps({"status": "installed", "version": VERSION,
                                                      "files": installed, "retired": retired}, indent=2),
                                            encoding="utf8")
    except BaseException:
        failures = []
        for name in reversed(installed):
            try:
                target = safe_path(root, name)
                if existing[name]:
                    shutil.copy2(previous / name, target)
                else:
                    target.unlink(missing_ok=True)
            except Exception as exc:
                failures.append({"file": name, "error": str(exc)})
        (backup / "result.json").write_text(json.dumps({"status": "rollback_incomplete" if failures else "rolled_back",
                                                      "files": installed, "restore_errors": failures}, indent=2), encoding="utf8")
        if failures:
            print("Manual code restoration is required. See", backup / "result.json")
        raise
    return backup


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true", help="Verify this source folder without installing")
    parser.add_argument("--target", type=Path, help="Existing installation, with Character Vault closed")
    args = parser.parse_args(argv)
    try:
        if args.verify:
            print(f"[OK] {len(verified_files(ROOT))} source files verified; Python 3.11 syntax is valid.")
        else:
            target = args.target or Path(input("Close Character Vault. Enter the EXISTING application folder: ").strip().strip('"'))
            saved = install(target)
            print("[OK] Character Vault", VERSION, "installed. Backup:", saved)
            try:
                retired = json.loads((saved / "result.json").read_text(encoding="utf8")).get("retired") or []
            except (OSError, ValueError):
                retired = []
            if retired:
                print(f"[OK] {len(retired)} old hotfix installers/notes moved to:", saved / "retired_files")
        return 0
    except Exception as exc:
        print("[ERROR]", exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
