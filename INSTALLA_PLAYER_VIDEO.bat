@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Character Vault - player video interno
cd /d "%~dp0"
echo.
echo  Character Vault - player video interno (Qt Multimedia)
echo  Installa solo i file del player nel Python privato dell'app (circa 22 MB).
echo  Per un controllo senza installare:  INSTALLA_PLAYER_VIDEO.bat --diagnose
echo.
if not exist "%~dp0tools\install_video_player.py" (
  echo [ERRORE] tools\install_video_player.py mancante: estrai tutto lo ZIP.
  goto :end
)
call "%~dp0RUN_PYTHON.bat" "%~dp0tools\install_video_player.py" %*
:end
echo.
pause
exit /b 0
