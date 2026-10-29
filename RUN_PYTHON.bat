@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
set "PYTHONHOME="
set "PYTHONPATH="
set "PYTHONUTF8=1"
if exist "%~dp0_runtime_v2\python\python.exe" goto private_v2
if exist "%~dp0_runtime\python\python.exe" goto private
if exist "%~dp0.venv\Scripts\python.exe" goto venv
py.exe -3.11 -c "import sys" >nul 2>nul
if not errorlevel 1 goto launcher
python.exe -c "import sys" >nul 2>nul
if not errorlevel 1 goto system
 echo [ERROR] Python was not found. Install Python 3.11 x64, then run this file again.
 echo This source ZIP does not include a Python executable. See START_HERE.txt.
 exit /b 3
:private_v2
"%~dp0_runtime_v2\python\python.exe" -X utf8 %*
exit /b %errorlevel%
:private
"%~dp0_runtime\python\python.exe" -X utf8 %*
exit /b %errorlevel%
:venv
"%~dp0.venv\Scripts\python.exe" -X utf8 %*
exit /b %errorlevel%
:launcher
py.exe -3.11 -X utf8 %*
exit /b %errorlevel%
:system
python.exe -X utf8 %*
exit /b %errorlevel%
