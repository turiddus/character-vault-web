"""Find WHICH DLL is missing when a PySide6 module fails with "DLL load failed".

Windows only says "The specified module could not be found" (German: "Das angegebene
Modul wurde nicht gefunden") without naming the file. This walks the PE import tables
(normal and delay-load) of a .pyd/.dll recursively and checks every dependency in the
same places Windows/PySide6 search: the PySide6 and shiboken6 folders, the Python
folder and System32. Pure Python, no third-party packages.

usage: python tools/qt_dll_doctor.py [QtMultimedia]
"""
from __future__ import annotations

import os
import struct
import sys
from pathlib import Path

# Media Foundation is an optional Windows component on "N" editions.
MEDIA_FOUNDATION = {"mf.dll", "mfplat.dll", "mfreadwrite.dll", "evr.dll", "mfcore.dll", "mfsensorgroup.dll"}
VC_RUNTIME = {"msvcp140.dll", "msvcp140_1.dll", "msvcp140_2.dll", "vcruntime140.dll", "vcruntime140_1.dll",
              "concrt140.dll"}


def pe_imports(path: str | Path) -> list[str]:
    """DLL names imported by a PE file (import + delay-import directories)."""
    data = Path(path).read_bytes()
    if data[:2] != b"MZ":
        raise ValueError("not a PE file")
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe:pe + 4] != b"PE\0\0":
        raise ValueError("bad PE signature")
    sections_count = struct.unpack_from("<H", data, pe + 6)[0]
    optional_size = struct.unpack_from("<H", data, pe + 20)[0]
    optional = pe + 24
    magic = struct.unpack_from("<H", data, optional)[0]
    directories = optional + (112 if magic == 0x20B else 96)
    count = struct.unpack_from("<I", data, directories - 4)[0]
    table = optional + optional_size
    sections = []
    for i in range(sections_count):
        base = table + 40 * i
        vsize, vaddr, rsize, raw = struct.unpack_from("<IIII", data, base + 8)
        sections.append((vaddr, max(vsize, rsize), raw))

    def offset(rva: int) -> int:
        for vaddr, size, raw in sections:
            if vaddr <= rva < vaddr + size:
                return rva - vaddr + raw
        raise ValueError("RVA outside sections")

    def cstring(rva: int) -> str:
        start = offset(rva)
        return data[start:data.index(b"\0", start)].decode("ascii", "replace")

    names: list[str] = []
    if count > 1:
        rva, _ = struct.unpack_from("<II", data, directories + 8 * 1)
        if rva:
            pos = offset(rva)
            while True:
                fields = struct.unpack_from("<IIIII", data, pos)
                if not any(fields):
                    break
                names.append(cstring(fields[3]))
                pos += 20
    if count > 13:
        rva, _ = struct.unpack_from("<II", data, directories + 8 * 13)
        if rva:
            pos = offset(rva)
            while True:
                fields = struct.unpack_from("<IIIIIIII", data, pos)
                if not any(fields):
                    break
                name_rva = fields[1]
                if not fields[0] & 1:          # very old VC6 format stored a VA
                    name_rva -= struct.unpack_from("<Q" if magic == 0x20B else "<I", data,
                                                   optional + (24 if magic == 0x20B else 28))[0]
                names.append(cstring(name_rva))
                pos += 32
    return names


def search_dirs(python_dir: Path) -> list[Path]:
    site = python_dir / "Lib" / "site-packages"
    dirs = [site / "PySide6", site / "shiboken6", python_dir]
    system = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32"
    return [d for d in dirs + [system] if d.is_dir()]


def diagnose(target: Path, python_dir: Path) -> list[dict]:
    """Missing dependencies of ``target`` (recursive). Empty list = every file was found."""
    dirs = search_dirs(python_dir)
    missing: list[dict] = []
    seen: set[str] = set()

    def find(name: str) -> Path | None:
        for folder in dirs:
            candidate = folder / name
            if candidate.is_file():
                return candidate
        return None

    def walk(path: Path, chain: list[str]):
        try:
            deps = pe_imports(path)
        except (OSError, ValueError, struct.error):
            return
        for dll in deps:
            key = dll.lower()
            if key.startswith(("api-ms-win-", "ext-ms-")) or key in seen:
                continue
            seen.add(key)
            found = find(dll)
            if found is None:
                missing.append({"dll": dll, "needed_by": " -> ".join(chain + [path.name])})
            elif found.parent.name.lower() != "system32":
                walk(found, chain + [path.name])

    walk(target, [])
    return missing


def advice(dll: str) -> str:
    key = dll.lower()
    if key in MEDIA_FOUNDATION:
        return ("Windows Media Foundation is missing (Windows 'N' edition). Install the Media Feature Pack: "
                "Settings > Apps > Optional features > Add a feature > 'Media Feature Pack', then restart Windows.")
    if key in VC_RUNTIME:
        return ("Microsoft Visual C++ runtime file missing. Install 'Microsoft Visual C++ Redistributable 2015-2022 x64' "
                "from Microsoft (aka.ms/vs/17/release/vc_redist.x64.exe).")
    if key.startswith(("qt6", "pyside6", "shiboken6", "avcodec", "avformat", "avutil", "swscale", "swresample")):
        return "Character Vault's private Python is incomplete: run START_AND_REPAIR_CHARACTER_VAULT.bat, then this installer again."
    if key.startswith("python"):
        return "The private Python runtime is damaged: run START_AND_REPAIR_CHARACTER_VAULT.bat."
    return "Windows system file missing or blocked by security software."


def report(module: str = "QtMultimedia", python_dir: Path | None = None) -> int:
    python_dir = Path(python_dir or Path(sys.executable).parent)
    pyside = python_dir / "Lib" / "site-packages" / "PySide6"
    targets = [pyside / f"{module}.pyd"]
    if module == "QtMultimedia":
        targets += [pyside / "QtMultimediaWidgets.pyd", pyside / "plugins" / "multimedia" / "ffmpegmediaplugin.dll"]
    problems = 0
    reported: set[str] = set()
    for target in targets:
        if not target.is_file():
            print(f"[MISSING] {target}")
            problems += 1
            continue
        for item in diagnose(target, python_dir):
            if item["dll"].lower() in reported:
                continue
            reported.add(item["dll"].lower())
            problems += 1
            print(f"[MISSING] {item['dll']}  (needed by {item['needed_by']})")
            print(f"          {advice(item['dll'])}")
    if not problems:
        print("[OK] every DLL needed by the video player was found.")
    return problems


if __name__ == "__main__":
    raise SystemExit(1 if report(sys.argv[1] if len(sys.argv) > 1 else "QtMultimedia") else 0)
