@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Character Vault - Installa il player video interno
cd /d "%~dp0"

rem ==========================================================================
rem  Aggiunge il player video interno (PySide6-Addons / Qt Multimedia) al Python
rem  privato di Character Vault (_runtime\python, versione embedded senza pip).
rem  Il pacchetto viene scaricato con la stessa versione di PySide6 gia' presente
rem  ed estratto in _runtime\python\Lib\site-packages, come fa la riparazione
rem  del runtime. Nessuna modifica al Python di sistema.
rem ==========================================================================

set "ROOT=%CD%"
set "PY=!ROOT!\_runtime\python\python.exe"
set "SP=!ROOT!\_runtime\python\Lib\site-packages"
set "TMPW=%TEMP%\cv_player_video"

echo.
echo  Character Vault - player video interno
echo.
if not exist "!PY!" goto :no_runtime
if not exist "!SP!\PySide6" goto :no_pyside

rem -------------------------------------------------------------- versione di PySide6 del runtime
set "VER="
for /d %%D in ("!SP!\pyside6_essentials-*.dist-info" "!SP!\PySide6_Essentials-*.dist-info") do (
  set "NAME=%%~nxD"
  for /f "tokens=2 delims=-" %%V in ("!NAME!") do set "VER=%%V"
)
if not defined VER (
  for /f "usebackq delims=" %%V in (`"!PY!" -c "import PySide6; print(PySide6.__version__)" 2^>nul`) do set "VER=%%V"
)
set "VER=!VER:.dist=!"
if not defined VER goto :no_version
echo  PySide6 nel runtime: !VER!

"!PY!" -c "import PySide6.QtMultimedia, PySide6.QtMultimediaWidgets" >nul 2>&1
if not errorlevel 1 goto :already

rem -------------------------------------------------------------- download del pacchetto (wheel)
if exist "!TMPW!" rmdir /s /q "!TMPW!"
mkdir "!TMPW!"
set "WHEEL="
where py >nul 2>&1 && set "SYSPY=py"
if not defined SYSPY where python >nul 2>&1 && set "SYSPY=python"
if defined SYSPY (
  echo  Scarico PySide6-Addons !VER! - circa 165 MB...
  !SYSPY! -m pip download "PySide6-Addons==!VER!" --no-deps --only-binary=:all: --platform win_amd64 --python-version 3.11 --implementation cp -d "!TMPW!" --disable-pip-version-check -q
)
for %%W in ("!TMPW!\*.whl") do set "WHEEL=%%~fW"
if defined WHEEL goto :extract

rem Senza Python di sistema: download diretto da PyPI tramite il suo indice JSON.
echo  Scarico PySide6-Addons !VER! da PyPI - circa 165 MB...
set "PKGVER=!VER!"
set "OUTDIR=!TMPW!"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; try { $j = Invoke-RestMethod ('https://pypi.org/pypi/PySide6-Addons/' + $env:PKGVER + '/json'); $f = $j.urls | Where-Object { $_.filename -like '*win_amd64.whl' } | Select-Object -First 1; if (-not $f) { throw 'wheel Windows non trovata' }; Invoke-WebRequest -UseBasicParsing -Uri $f.url -OutFile (Join-Path $env:OUTDIR $f.filename); exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
for %%W in ("!TMPW!\*.whl") do set "WHEEL=%%~fW"
if not defined WHEEL goto :download_failed

rem -------------------------------------------------------------- estrazione in site-packages
:extract
echo  Estrazione in _runtime\python\Lib\site-packages...
set "WHL=!WHEEL!"
set "DEST=!SP!"
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [System.IO.Compression.ZipFile]::OpenRead($env:WHL); foreach ($e in $z.Entries) { if ($e.FullName.EndsWith('/')) { continue }; $t = Join-Path $env:DEST $e.FullName; $d = Split-Path $t; if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }; [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $t, $true) }; $z.Dispose(); exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 goto :extract_failed
rmdir /s /q "!TMPW!" 2>nul

"!PY!" -c "import PySide6.QtMultimedia, PySide6.QtMultimediaWidgets; print('ok')" >nul 2>&1
if errorlevel 1 goto :verify_failed
echo.
echo  FATTO: player video interno installato. Riavvia Character Vault:
echo  nella sezione Video, "Riproduci" usera' il player dell'app.
goto :end

:already
echo.
echo  Il player video interno e' gia' installato.
goto :end

:no_runtime
echo [ERRORE] Python privato non trovato: "!PY!"
echo          Avvia questo file dalla cartella principale di Character Vault.
goto :end
:no_pyside
echo [ERRORE] PySide6 non trovato nel runtime: usa AVVIA_E_RIPARA_CHARACTER_VAULT_V2.bat
goto :end
:no_version
echo [ERRORE] Versione di PySide6 del runtime non riconosciuta.
goto :end
:download_failed
echo [ERRORE] Download di PySide6-Addons non riuscito - controlla la connessione.
goto :end
:extract_failed
echo [ERRORE] Estrazione non riuscita: chiudi Character Vault e riprova.
goto :end
:verify_failed
echo [ERRORE] Il player non si avvia dopo l'installazione.
"!PY!" -c "import PySide6.QtMultimedia"
goto :end

:end
echo.
pause
exit /b 0
