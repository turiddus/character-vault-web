@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Character Vault - Compila APK Android
cd /d "%~dp0"

rem ==========================================================================
rem  Character Vault - compila l'app Android (CharacterVault.apk)
rem
rem  La compilazione avviene in una cartella di lavoro corta e senza caratteri
rem  speciali (C:\CVBuild): i percorsi con "&" (es. C:\Users\Nome&Nome) o troppo
rem  lunghi fanno fallire gli strumenti Android su Windows. Java 17, Android SDK
rem  e Gradle vengono scaricati la prima volta in C:\CVBuild\tools (circa 1 GB,
rem  10-20 minuti); nulla viene installato nel sistema. Poi 1-3 minuti.
rem  L'APK e la chiave di firma restano in questa cartella.
rem ==========================================================================

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
set "KEYPASS=charactervault"
set "JDK_URL=https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse"
set "CMDTOOLS_URL=https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"

echo.
echo  ============================================================
echo    CHARACTER VAULT - COMPILAZIONE APP ANDROID
echo  ============================================================
echo.

if not exist "!SRC_APP!\gradlew.bat" goto :no_project
if not exist "!SRC_WEB!\index.html" goto :no_web
echo  Progetto:          "!ROOT!"
echo  Cartella di lavoro: "!WORK!"
echo.
if not exist "!TOOLS!" mkdir "!TOOLS!" || goto :no_work

rem -------------------------------------------------------------- 0. copia del progetto
rem robocopy gestisce percorsi lunghi; codici di uscita 0-7 = riuscito.
robocopy "!SRC_APP!" "!APP!" /MIR /XD tools build .gradle /XF local.properties keystore.properties *.jks /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :copy_failed
robocopy "!SRC_WEB!" "!WORK!\web_app" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :copy_failed
if exist "!SRC_APP!\charactervault.jks" copy /y "!SRC_APP!\charactervault.jks" "!APP!\charactervault.jks" >nul

rem -------------------------------------------------------------- 1. Java 17
call :find_java
if defined JAVA_HOME goto :java_ok
echo [1/5] Scarico Java 17 - Eclipse Temurin, circa 190 MB...
call :download "!JDK_URL!" "!TOOLS!\jdk.zip" || goto :fail
echo       Estrazione...
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

rem -------------------------------------------------------------- 2. Android SDK
set "SDKMANAGER=!SDK!\cmdline-tools\latest\bin\sdkmanager.bat"
if exist "!SDKMANAGER!" goto :sdk_tools_ok
echo [2/5] Scarico gli strumenti Android SDK - circa 150 MB...
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
echo [2/5] Accetto le licenze Android SDK e installo piattaforma 35 e build-tools...
rem Licenze standard dell'SDK (le stesse che si accettano in Android Studio), scritte direttamente.
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
if errorlevel 1 goto :sdk_install_failed
:sdk_ok
echo [2/5] Android SDK: "!SDK!"
set "ANDROID_HOME=!SDK!"
set "ANDROID_SDK_ROOT=!SDK!"
set "SDKF=!SDK:\=/!"
> "!APP!\local.properties" echo sdk.dir=!SDKF!

rem -------------------------------------------------------------- 3. Firma dell'app
if exist "!APP!\charactervault.jks" goto :key_ok
echo [3/5] Creo la chiave di firma dell'app - una volta sola...
"!JAVA_HOME!\bin\keytool.exe" -genkeypair -keystore "!APP!\charactervault.jks" -alias vault -storepass !KEYPASS! -keypass !KEYPASS! -keyalg RSA -keysize 2048 -validity 36500 -dname "CN=Character Vault, O=turiddus" >nul 2>&1
if errorlevel 1 goto :key_failed
copy /y "!APP!\charactervault.jks" "!SRC_APP!\charactervault.jks" >nul
:key_ok
> "!APP!\keystore.properties" (
  echo storeFile=charactervault.jks
  echo storePassword=!KEYPASS!
  echo keyAlias=vault
  echo keyPassword=!KEYPASS!
)
echo [3/5] Chiave di firma: "!SRC_APP!\charactervault.jks"
echo       IMPORTANTE: conservala - gli aggiornamenti dell'app vanno firmati con la stessa chiave.

rem -------------------------------------------------------------- 4. Compilazione
echo [4/5] Compilazione - la prima volta Gradle scarica circa 300 MB di librerie...
pushd "!APP!"
call gradlew.bat --no-daemon assembleRelease
set "BUILD_ERR=!errorlevel!"
popd
if not "!BUILD_ERR!"=="0" goto :build_failed
set "APK=!APP!\app\build\outputs\apk\release\app-release.apk"
if not exist "!APK!" goto :apk_missing
copy /y "!APK!" "!ROOT!\CharacterVault.apk" >nul || goto :copy_failed
echo [4/5] APK pronto: "!ROOT!\CharacterVault.apk"

rem -------------------------------------------------------------- 5. Accesso Google
echo.
echo [5/5] Impronta SHA-1 della firma - serve UNA volta in Google Cloud:
echo       Client OAuth tipo Android, pacchetto io.github.turiddus.charactervault
set "SHA1="
for /f "tokens=1,* delims=:" %%A in ('call "!JAVA_HOME!\bin\keytool.exe" -list -v -keystore "!APP!\charactervault.jks" -alias vault -storepass !KEYPASS! 2^>nul ^| findstr /c:"SHA1"') do set "SHA1=%%B"
set "SHA1=!SHA1: =!"
echo.
echo       SHA-1:  !SHA1!
echo.
> "!ROOT!\SHA1_ANDROID.txt" (
  echo Pacchetto: io.github.turiddus.charactervault
  echo SHA-1:     !SHA1!
)
echo       Salvata anche in SHA1_ANDROID.txt

rem -------------------------------------------------------------- installazione facoltativa
set "ADB=!SDK!\platform-tools\adb.exe"
if not exist "!ADB!" goto :done
"!ADB!" start-server >nul 2>&1
set "DEVICE="
for /f "skip=1 tokens=1,2" %%A in ('call "!ADB!" devices') do if "%%B"=="device" set "DEVICE=%%A"
if not defined DEVICE goto :done
echo.
choice /c SN /m "Telefono collegato via USB: installare ora l'app"
if errorlevel 2 goto :done
"!ADB!" install -r "!ROOT!\CharacterVault.apk"

:done
echo.
echo  ============================================================
echo    FATTO. Copia CharacterVault.apk sul telefono e aprilo
echo    per installarlo, oppure collega il telefono via USB con
echo    il debug USB attivo e rilancia questo file.
echo  ============================================================
echo.
pause
exit /b 0

rem ========================================================================== errori
:no_project
echo [ERRORE] Cartella android_app non trovata accanto a questo file.
goto :fail
:no_web
echo [ERRORE] Cartella web_app non trovata: serve per l'interfaccia dell'app.
goto :fail
:no_work
echo [ERRORE] Impossibile creare la cartella di lavoro "!WORK!".
echo          Imposta un'altra cartella senza spazi speciali, es.:  set CV_BUILD_DIR=D:\CVBuild
goto :fail
:copy_failed
echo [ERRORE] Copia dei file non riuscita.
goto :fail
:java_missing
echo [ERRORE] Java non installato correttamente in "!JDK!"
goto :fail
:sdk_missing
echo [ERRORE] sdkmanager non trovato dopo l'estrazione degli strumenti Android.
goto :fail
:sdk_install_failed
echo [ERRORE] Installazione dei componenti Android non riuscita - controlla la connessione.
goto :fail
:key_failed
echo [ERRORE] Creazione della chiave di firma non riuscita.
goto :fail
:build_failed
echo.
echo [ERRORE] Compilazione non riuscita. Copia le righe rosse qui sopra e mandale a Claude.
goto :fail
:apk_missing
echo [ERRORE] APK non trovato: "!APK!"
goto :fail

:fail
echo.
echo  Compilazione interrotta.
echo.
pause
exit /b 1

rem ========================================================================== funzioni
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
echo [ERRORE] Download non riuscito: "!DL_URL!"
exit /b 1

:unzip
set "UZ_IN=%~1"
set "UZ_OUT=%~2"
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:UZ_IN, $env:UZ_OUT); exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 goto :unzip_failed
exit /b 0
:unzip_failed
echo [ERRORE] Estrazione non riuscita: "!UZ_IN!"
exit /b 1
