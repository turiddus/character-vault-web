"""Redirect old main.py launchers to the verified private interpreter."""
import json
import os
import subprocess
import sys
from pathlib import Path


def runtime_env(root, executable, probe=False):
    env = os.environ.copy()
    try:
        from character_vault.scheduling import notebook_native_env
        notebook_native_env(env)
    except ImportError:
        pass  # The repair entry can also be copied into an older installation.
    for key in ("PYTHONHOME", "PYTHONPATH", "QT_QPA_PLATFORM", "QT_PLUGIN_PATH", "QT_QPA_PLATFORM_PLUGIN_PATH", "QML2_IMPORT_PATH"):
        env.pop(key, None)
    plugins = Path(executable).parent / "Lib/site-packages/PySide6/plugins"
    if plugins.is_dir():
        env["QT_PLUGIN_PATH"] = str(plugins)
        env["QT_QPA_PLATFORM_PLUGIN_PATH"] = str(plugins / "platforms")
    if probe:
        env["QT_QPA_PLATFORM"] = "offscreen"
    env["CHARACTER_VAULT_HOME"] = str(root)
    env["PYTHONUTF8"] = "1"
    return env


def configured_runtime(root):
    root = Path(root).resolve()
    config = json.loads((root / "CV_RUNTIME_V2.json").read_text(encoding="utf-8"))
    relative = Path(config["interpreter"])
    if relative.is_absolute() or ".." in relative.parts:
        raise RuntimeError("Invalid runtime configuration. Run START_AND_REPAIR_CHARACTER_VAULT.bat.")
    executable = (root / relative).resolve()
    if root not in executable.parents or not executable.is_file():
        raise RuntimeError("Private runtime missing. Run START_AND_REPAIR_CHARACTER_VAULT.bat.")
    return executable


def redirect_to_private(main_file):
    if os.name != "nt" or getattr(sys, "frozen", False):
        return
    root = Path(main_file).resolve().parent
    executable = configured_runtime(root)
    current = Path(sys.executable).resolve()
    if (os.path.normcase(str(current.parent)) == os.path.normcase(str(executable.parent))
            and current.name.lower() in ("python.exe", "pythonw.exe")):
        return
    # Preserve the original application arguments, including --self-test/data-dir.
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    code = subprocess.call([str(executable), "-X", "utf8", str(Path(main_file).resolve()), *sys.argv[1:]],
                           cwd=str(root), env=runtime_env(root, executable), creationflags=flags)
    raise SystemExit(code)
