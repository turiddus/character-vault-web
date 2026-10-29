"""CI stand-in: imports what the real CineRemix GUI imports, so the private runtime is checked for real."""
from PySide6.QtCore import Qt, Signal, QThread, QTimer, QUrl, QRectF  # noqa: F401
from PySide6.QtGui import QPainter, QColor, QPen, QPixmap, QDesktopServices, QAction  # noqa: F401
from PySide6.QtMultimedia import QMediaPlayer, QAudioOutput  # noqa: F401
from PySide6.QtMultimediaWidgets import QVideoWidget  # noqa: F401
from PySide6.QtWidgets import QMainWindow, QListWidget
import cv2, av, numpy, scipy.signal, psutil, imageio_ffmpeg  # noqa: F401,E401
import google_auth_oauthlib.flow, yt_dlp  # noqa: F401,E401


class Window(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("CineRemix60 · Auto Studio 3.0.6 · Film Director")
        self.media = QListWidget()
        self.setCentralWidget(self.media)
        self.player = QMediaPlayer()

    def add_paths(self, paths):
        for path in paths:
            self.media.addItem(path)
