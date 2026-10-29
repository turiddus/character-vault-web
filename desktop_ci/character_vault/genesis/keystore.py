"""OpenAI API key for Genesis, on this PC only (8.2).

Order: the OPENAI_API_KEY environment variable (as in 8.0/8.1), otherwise the key saved from Genesis Studio,
encrypted with Windows DPAPI for the current Windows user in Data/genesis/openai_api_key.dpapi.
The key never goes into the catalog, Drive, the phone or the logs; another Windows user (or another PC)
cannot decrypt the saved file.
"""
from __future__ import annotations

import ctypes
import os
import sys
from pathlib import Path

ENV = "OPENAI_API_KEY"
FILE = "openai_api_key.dpapi"
_ENTROPY = b"CharacterVault-Genesis-v1"


class KeyStoreError(RuntimeError):
    pass


def _dpapi(protect: bool, data: bytes) -> bytes:
    if sys.platform != "win32":
        raise KeyStoreError("Saving the key requires Windows (DPAPI). Use the OPENAI_API_KEY variable instead.")
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    def blob(raw: bytes):
        buffer = ctypes.create_string_buffer(raw, len(raw))
        return Blob(len(raw), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char))), buffer

    source, keep1 = blob(data)
    entropy, keep2 = blob(_ENTROPY)
    out = Blob()
    crypt32 = ctypes.windll.crypt32
    function = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    ok = function(ctypes.byref(source), None, ctypes.byref(entropy), None, None, 0x01, ctypes.byref(out))
    if not ok:
        raise KeyStoreError("Windows could not " + ("encrypt" if protect else "decrypt") + " the saved key.")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(out.pbData)


def key_file(data_dir) -> Path:
    return Path(data_dir) / "genesis" / FILE


def valid(key: str) -> bool:
    key = (key or "").strip()
    return 20 <= len(key) <= 400 and not any(c.isspace() for c in key) and key.isascii()


def source(data_dir) -> str:
    if os.environ.get(ENV, "").strip():
        return "environment"
    return "saved" if key_file(data_dir).is_file() else ""


def api_key(data_dir) -> str:
    value = os.environ.get(ENV, "").strip()
    if value:
        return value
    path = key_file(data_dir)
    if not path.is_file():
        return ""
    try:
        return _dpapi(False, path.read_bytes()).decode("utf-8").strip()
    except (KeyStoreError, OSError, UnicodeDecodeError):
        return ""


def save_key(data_dir, key: str) -> None:
    key = (key or "").strip()
    if not valid(key):
        raise KeyStoreError("This does not look like an API key (no spaces, at least 20 characters).")
    path = key_file(data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_bytes(_dpapi(True, key.encode("utf-8")))
    os.replace(temp, path)


def clear_key(data_dir) -> bool:
    try:
        key_file(data_dir).unlink()
        return True
    except FileNotFoundError:
        return False
