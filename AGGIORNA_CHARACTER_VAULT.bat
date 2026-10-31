@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
title Character Vault 9.0.9 - aggiornamento
echo.
echo  ============================================================
echo    CHARACTER VAULT 9.0.9 - AGGIORNAMENTO DEL PROGRAMMA
echo  ============================================================
echo  Prima: chiudi Character Vault su questo PC.
echo  Restano intatti: Data, Library, catalogo, accesso Google, chiave Android, Python privato.
echo  Backup automatico di codice e catalogo in Data\backups\updates.
echo.
if not exist "%~dp0install_update.py" (
  echo [ERRORE] Estrai TUTTO lo ZIP in una cartella nuova e avvia questo file da li.
  pause
  exit /b 2
)
set "TARGET=C:\AI\CharacterVault"
set "INPUT="
set /p "INPUT=Cartella di Character Vault gia installato [C:\AI\CharacterVault]: "
if defined INPUT set "TARGET=%INPUT%"
set "TARGET=%TARGET:"=%"
if not exist "%TARGET%\main.py" (
  echo [ERRORE] In "%TARGET%" non trovo Character Vault ^(main.py^).
  pause
  exit /b 2
)
set "CONFIRM="
set /p "CONFIRM=Scrivi AGGIORNA e premi Invio per continuare: "
if /I not "%CONFIRM%"=="AGGIORNA" (
  echo Annullato: nessuna modifica.
  pause
  exit /b 2
)
set "PYTHON="
if exist "%TARGET%\.venv\Scripts\python.exe" set "PYTHON=%TARGET%\.venv\Scripts\python.exe"
if exist "%TARGET%\_runtime\python\python.exe" set "PYTHON=%TARGET%\_runtime\python\python.exe"
if exist "%TARGET%\_runtime_v2\python\python.exe" set "PYTHON=%TARGET%\_runtime_v2\python\python.exe"
if defined PYTHON goto :run
rem No private runtime: a Python 3.9+ on PATH, then the py launcher.
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>nul
if not errorlevel 1 set "PYTHON=python" & goto :run
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>nul
if not errorlevel 1 set "PYTHON=py -3" & goto :run
echo [ERRORE] Python non trovato: avvia prima START_AND_REPAIR_CHARACTER_VAULT.bat nella cartella installata.
pause
exit /b 1
:run
if exist "%PYTHON%" (
  "%PYTHON%" -X utf8 "%~dp0install_update.py" --target "%TARGET%"
) else (
  %PYTHON% -X utf8 "%~dp0install_update.py" --target "%TARGET%"
)
if errorlevel 1 (
  echo.
  echo [ERRORE] Aggiornamento fermato: il programma installato NON e stato modificato o e stato ripristinato.
  pause
  exit /b 1
)
echo.
echo  FATTO. Avvia Character Vault come sempre ^(START_NOTEBOOK_8GB.bat o START_CHARACTER_VAULT.bat^).
echo  Poi ricompila l'app Android con BUILD_ANDROID_APK.bat nella cartella installata ^(vedi LEGGIMI.md^).
echo.
pause
exit /b 0
