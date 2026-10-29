@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Character Vault - Build Android APK
cd /d "%~dp0"

rem

set "ROOT=%CD%"
set "SRC_APP=%ROOT%\android_app"
set "SRC_WEB=%ROOT%\web_app"
if not defined CV_BUILD_DIR set "CV_BUILD_DIR=%SystemDrive%\CVBuild"
set "WORK=%CV_BUILD_DIR%"
set "APP=%WORK%\android_app"
set "TOOLS=%WORK%\tools"
set "SDK=%TOOLS%\android-sdk"
set "JDK=%TOOLS%\jdk"
set "GRADLE_USER_HOME=%TOOLS%\gradle-home"
rem Signing passwords must NEVER be guessed or rewritten by this batch file.
rem tools\prepare_android_signing.ps1 validates the ORIGINAL private key first.
set "JDK_URL=https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse"
set "CMDTOOLS_URL=https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"

echo.
echo  ============================================================
echo    CHARACTER VAULT - ANDROID APP BUILD
echo  ============================================================
echo.

if not exist "!SRC_APP!\gradlew.bat" goto :no_project
if not exist "!SRC_WEB!\index.html" goto :no_web
echo  Project:          "!ROOT!"
echo  Working folder: "!WORK!"
echo.
if not exist "!TOOLS!" mkdir "!TOOLS!" || goto :no_work

rem /E (not /MIR) ensures old keys in C:\CVBuild cannot be purged during source sync.
robocopy "!SRC_APP!" "!APP!" /E /XD tools build .gradle /XF local.properties keystore.properties* *.jks* /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :copy_failed
robocopy "!SRC_WEB!" "!WORK!\web_app" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :copy_failed

call :find_java
if defined JAVA_HOME goto :java_ok
echo [1/5] Downloading Java 17 - Eclipse Temurin, about 190 MB...
call :download "!JDK_URL!" "!TOOLS!\jdk.zip" || goto :fail
echo       Extracting...
if exist "!TOOLS!\jdk_tmp" rmdir /s /q "!TOOLS!\jdk_tmp"
call :unzip "!TOOLS!\jdk.zip" "!TOOLS!\jdk_tmp" || goto :fail
for /d %%D in ("!TOOLS!\jdk_tmp\*") do move "%%~fD" "!JDK!" >nul
rmdir /s /q "!TOOLS!\jdk_tmp" 2>nul
del "!TOOLS!\jdk.zip" 2>nul
call :find_java
if not defined JAVA_HOME goto :java_missing
:java_ok
echo [1/5] Java: "!JAVA_HOME!"
set "PATH=!JAVA_HOME!\bin;!PATH!"

set "SDKMANAGER=!SDK!\cmdline-tools\latest\bin\sdkmanager.bat"
if exist "!SDKMANAGER!" goto :sdk_tools_ok
echo [2/5] Downloading Android SDK tools - about 150 MB...
call :download "!CMDTOOLS_URL!" "!TOOLS!\cmdtools.zip" || goto :fail
if exist "!TOOLS!\cmd_tmp" rmdir /s /q "!TOOLS!\cmd_tmp"
call :unzip "!TOOLS!\cmdtools.zip" "!TOOLS!\cmd_tmp" || goto :fail
if not exist "!SDK!\cmdline-tools" mkdir "!SDK!\cmdline-tools"
move "!TOOLS!\cmd_tmp\cmdline-tools" "!SDK!\cmdline-tools\latest" >nul
rmdir /s /q "!TOOLS!\cmd_tmp" 2>nul
del "!TOOLS!\cmdtools.zip" 2>nul
if not exist "!SDKMANAGER!" goto :sdk_missing
:sdk_tools_ok
if exist "!SDK!\platforms\android-35\android.jar" if exist "!SDK!\build-tools\35.0.0" goto :sdk_ok
echo [2/5] Installing Android platform 35 and build tools...
rem Standard Android SDK license hashes (the ones accepted in Android Studio), written
rem directly: piping "y" into sdkmanager --licenses does not work reliably from a BAT.
if not exist "!SDK!\licenses" mkdir "!SDK!\licenses"
> "!SDK!\licenses\android-sdk-license" (
  echo.
  echo 8933bad161af4178b1185d1a37fbf41ea5269c55
  echo d56f5187479451eabf01fb78af6dfcb131a6481e
  echo 24333f8a63b6825ea9c5514f83c2829b004d1fee
)
> "!SDK!\licenses\android-sdk-preview-license" (
  echo.
  echo 84831b9409646a918e30573bab4c9c91346d8abd
)
call "!SDKMANAGER!" --sdk_root="!SDK!" "platform-tools" "platforms;android-35" "build-tools;35.0.0"
if not errorlevel 1 goto :sdk_ok
echo       Accept the Android SDK licenses below (type y and Enter), then the install is retried.
call "!SDKMANAGER!" --sdk_root="!SDK!" --licenses
call "!SDKMANAGER!" --sdk_root="!SDK!" "platform-tools" "platforms;android-35" "build-tools;35.0.0"
if errorlevel 1 goto :sdk_install_failed
:sdk_ok
echo [2/5] Android SDK: "!SDK!"
set "ANDROID_HOME=!SDK!"
set "ANDROID_SDK_ROOT=!SDK!"
set "SDKF=!SDK:\=/!"
> "!APP!\local.properties" echo sdk.dir=!SDKF!

echo [3/5] Checking the EXISTING signing key before packaging...
powershell -NoProfile -ExecutionPolicy Bypass -File "!ROOT!\tools\prepare_android_signing.ps1" -SourceApp "!SRC_APP!" -WorkApp "!APP!" -Keytool "!JAVA_HOME!\bin\keytool.exe"
if errorlevel 1 goto :signing_failed
echo [3/5] Signing key validated: "!SRC_APP!\charactervault.jks"
echo       Keep charactervault.jks and keystore.properties safely backed up.
echo [3/5] Verifying EXACT Gradle properties with Java...
if not exist "!ROOT!\tools\CVSigningCheck.java" goto :signing_failed
"!JAVA_HOME!\bin\java.exe" "!ROOT!\tools\CVSigningCheck.java" "!APP!\keystore.properties"
if errorlevel 1 goto :signing_failed

echo [4/5] Building - Gradle downloads about 300 MB of libraries on the first run...
pushd "!APP!"
call gradlew.bat --no-daemon assembleRelease
set "BUILD_ERR=!errorlevel!"
popd
if not "!BUILD_ERR!"=="0" goto :build_failed
set "APK=!APP!\app\build\outputs\apk\release\app-release.apk"
if not exist "!APK!" goto :apk_missing
copy /y "!APK!" "!ROOT!\CharacterVault.apk" >nul || goto :copy_failed
echo [4/5] APK ready: "!ROOT!\CharacterVault.apk"

echo.
echo [5/5] Signing SHA-1 fingerprint (configure once in Google Cloud):
echo       Android OAuth client, package io.github.turiddus.charactervault
if exist "!ROOT!\SHA1_ANDROID.txt" type "!ROOT!\SHA1_ANDROID.txt"
echo.
echo       Also saved to SHA1_ANDROID.txt

set "ADB=!SDK!\platform-tools\adb.exe"
if not exist "!ADB!" goto :done
"!ADB!" start-server >nul 2>&1
set "DEVICE="
for /f "skip=1 tokens=1,2" %%A in ('call "!ADB!" devices') do if "%%B"=="device" set "DEVICE=%%A"
if not defined DEVICE goto :done
echo.
choice /c YN /m "Phone connected by USB: install the app now"
if errorlevel 2 goto :done
"!ADB!" install -r "!ROOT!\CharacterVault.apk"

:done
echo.
echo  ============================================================
echo    DONE. Copy CharacterVault.apk to your phone and open it
echo    to install it, or connect the phone by USB with
echo    USB debugging enabled and run this file again.
echo  ============================================================
echo.
pause
exit /b 0

:no_project
echo [ERROR] android_app folder not found next to this file.
goto :fail
:no_web
echo [ERROR] web_app folder not found; it contains the interface.
goto :fail
:no_work
echo [ERROR] Cannot create the working folder "!WORK!".
echo          Choose a short folder without special characters, e.g.:  set CV_BUILD_DIR=D:\CVBuild
goto :fail
:copy_failed
echo [ERROR] File copy failed.
goto :fail
:java_missing
echo [ERROR] Java is not correctly installed in "!JDK!"
goto :fail
:sdk_missing
echo [ERROR] sdkmanager not found after extracting Android tools.
goto :fail
:sdk_install_failed
echo [ERROR] Android component installation failed; check the connection.
goto :fail
:signing_failed
echo [ERROR] Signing preflight failed. APK build NOT attempted.
echo         Keep the original keystore. See signing error above.
goto :fail
:build_failed
echo.
echo [ERROR] Build failed. Review the error messages above.
goto :fail
:apk_missing
echo [ERROR] APK not found: "!APK!"
goto :fail

:fail
echo.
echo  Build stopped.
echo.
pause
exit /b 1

:find_java
set "JAVA_HOME="
if exist "!JDK!\bin\java.exe" set "JAVA_HOME=!JDK!"
exit /b 0

:download
set "DL_URL=%~1"
set "DL_OUT=%~2"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -UseBasicParsing -Uri $env:DL_URL -OutFile $env:DL_OUT; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 goto :download_failed
exit /b 0
:download_failed
echo [ERROR] Download failed: "!DL_URL!"
exit /b 1

:unzip
set "UZ_IN=%~1"
set "UZ_OUT=%~2"
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:UZ_IN, $env:UZ_OUT); exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 goto :unzip_failed
exit /b 0
:unzip_failed
echo [ERROR] Extraction failed: "!UZ_IN!"
exit /b 1
