"""CI stand-in for CineRemix/app.py: same --add contract; records what it received and exits."""
import json, os, sys
from pathlib import Path


def requested_sources(argv):
    if "--add" not in argv:
        return []
    files = []
    for value in argv[argv.index("--add") + 1:]:
        if value.startswith("--"):
            break
        if Path(value).exists():
            files.append(str(Path(value).resolve()))
    return files


def main():
    from PySide6.QtCore import QTimer
    from PySide6.QtWidgets import QApplication
    from cineremix.gui import Window
    sources = requested_sources(sys.argv)
    app = QApplication(["stub", "-platform", "offscreen"])
    window = Window()
    window.show()
    window.add_paths(sources)

    def report():
        out = os.environ.get("CV_STUB_OUT")
        if out:
            Path(out).write_text(json.dumps({"sources": sources, "items": window.media.count(),
                                             "python": sys.version.split()[0]}), encoding="utf-8")
        app.quit()
    QTimer.singleShot(800, report)
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
