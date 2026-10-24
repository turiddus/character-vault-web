@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Character Vault - Compila APK Android
cd /d "%~dp0"

rem ==========================================================================
rem  Character Vault - compila l'app Android (CharacterVault.apk)
rem  Tutto quello che serve (Java 17, Android SDK, Gradle) viene scaricato la
rem  prima volta in android_app\tools, dentro questa cartella: nulla viene
rem  installato nel sistema. Prima volta: circa 1 GB e 10-20 minuti.
rem  Le volte successive: 1-3 minuti.
rem ==========================================================================

set "ROOT=%CD%"
set "APP=%ROOT%\android_app"
set "TOOLS=%APP%\tools"
set "SDK=%TOOLS%\android-sdk"
set "JDK=%TOOLS%\jdk"
set "GRADLE_USER_HOME=%TOOLS%\gradle-home"
set "KEYSTORE=%APP%\charactervault.jks"
set "KEYPASS=charactervault"
set "JDK_URL=https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse"
set "CMDTOOLS_URL=https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"

echo.
echo  ============================================================
echo    CHARACTER VAULT - COMPILAZIONE APP ANDROID
echo  ============================================================
echo.

if not exist "%APP%\gradlew.bat" (
  echo [ERRORE] Cartella android_app non trovata accanto a questo file.
  goto :fail
)
if not exist "%ROOT%\web_app\index.html" (
  echo [ERRORE] Cartella web_app non trovata: serve per l'interfaccia dell'app.
  goto :fail
)
if not exist "%TOOLS%" mkdir "%TOOLS%"

rem -------------------------------------------------------------- 1. Java 17
call :find_java
if defined JAVA_HOME goto :java_ok
echo [1/5] Scarico Java 17 - Eclipse Temurin, circa 190 MB...
call :download "%JDK_URL%" "%TOOLS%\jdk.zip" || goto :fail
echo       Estrazione...
if exist "%TOOLS%\jdk_tmp" rmdir /s /q "%TOOLS%\jdk_tmp"
call :unzip "%TOOLS%\jdk.zip" "%TOOLS%\jdk_tmp" || goto :fail
for /d %%D in ("%TOOLS%\jdk_tmp\*") do move "%%D" "%JDK%" >nul
rmdir /s /q "%TOOLS%\jdk_tmp" 2>nul
del "%TOOLS%\jdk.zip" 2>nul
call :find_java
if not defined JAVA_HOME goto :java_missing
:java_ok
echo [1/5] Java: %JAVA_HOME%
set "PATH=%JAVA_HOME%\bin;%PATH%"

rem -------------------------------------------------------------- 2. Android SDK
set "SDKMANAGER=%SDK%\cmdline-tools\latest\bin\sdkmanager.bat"
if exist "%SDKMANAGER%" goto :sdk_tools_ok
echo [2/5] Scarico gli strumenti Android SDK - circa 150 MB...
call :download "%CMDTOOLS_URL%" "%TOOLS%\cmdtools.zip" || goto :fail
if exist "%TOOLS%\cmd_tmp" rmdir /s /q "%TOOLS%\cmd_tmp"
call :unzip "%TOOLS%\cmdtools.zip" "%TOOLS%\cmd_tmp" || goto :fail
if not exist "%SDK%\cmdline-tools" mkdir "%SDK%\cmdline-tools"
move "%TOOLS%\cmd_tmp\cmdline-tools" "%SDK%\cmdline-tools\latest" >nul
rmdir /s /q "%TOOLS%\cmd_tmp" 2>nul
del "%TOOLS%\cmdtools.zip" 2>nul
if not exist "%SDKMANAGER%" goto :sdk_missing
:sdk_tools_ok
if exist "%SDK%\platforms\android-35\android.jar" if exist "%SDK%\build-tools\35.0.0" goto :sdk_ok
echo [2/5] Accetto le licenze Android SDK e installo piattaforma 35 e build-tools...
(for /l %%i in (1,1,40) do @echo y) | "%SDKMANAGER%" --sdk_root="%SDK%" --licenses >nul 2>&1
call "%SDKMANAGER%" --sdk_root="%SDK%" "platform-tools" "platforms;android-35" "build-tools;35.0.0"
if errorlevel 1 (
  echo [ERRORE] Installazione dei componenti Android non riuscita - controlla la connessione.
  goto :fail
)
:sdk_ok
echo [2/5] Android SDK: %SDK%
set "ANDROID_HOME=%SDK%"
set "ANDROID_SDK_ROOT=%SDK%"
set "SDKF=%SDK:\=/%"
> "%APP%\local.properties" echo sdk.dir=%SDKF%

rem -------------------------------------------------------------- 3. Firma dell'app
if exist "%KEYSTORE%" goto :key_ok
echo [3/5] Creo la chiave di firma dell'app - una volta sola...
"%JAVA_HOME%\bin\keytool.exe" -genkeypair -keystore "%KEYSTORE%" -alias vault -storepass %KEYPASS% -keypass %KEYPASS% -keyalg RSA -keysize 2048 -validity 36500 -dname "CN=Character Vault, O=turiddus" >nul 2>&1
if errorlevel 1 (
  echo [ERRORE] Creazione della chiave non riuscita.
  goto :fail
)
:key_ok
> "%APP%\keystore.properties" (
  echo storeFile=charactervault.jks
  echo storePassword=%KEYPASS%
  echo keyAlias=vault
  echo keyPassword=%KEYPASS%
)
echo [3/5] Chiave di firma: %KEYSTORE%
echo       IMPORTANTE: conservala - gli aggiornamenti dell'app vanno firmati con la stessa chiave.

rem -------------------------------------------------------------- 4. Compilazione
echo [4/5] Compilazione - la prima volta Gradle scarica circa 300 MB di librerie...
pushd "%APP%"
call gradlew.bat --no-daemon assembleRelease
set "BUILD_ERR=%errorlevel%"
popd
if not "%BUILD_ERR%"=="0" (
  echo.
  echo [ERRORE] Compilazione non riuscita. Copia le righe rosse qui sopra e mandale a Claude.
  goto :fail
)
set "APK=%APP%\app\build\outputs\apk\release\app-release.apk"
if not exist "%APK%" goto :apk_missing
copy /y "%APK%" "%ROOT%\CharacterVault.apk" >nul
echo [4/5] APK pronto: %ROOT%\CharacterVault.apk

rem -------------------------------------------------------------- 5. Accesso Google
echo.
echo [5/5] Impronta SHA-1 della firma - serve UNA volta in Google Cloud:
echo       Client OAuth tipo Android, pacchetto io.github.turiddus.charactervault
set "SHA1="
for /f "tokens=1,* delims=:" %%A in ('call "%JAVA_HOME%\bin\keytool.exe" -list -v -keystore "%KEYSTORE%" -alias vault -storepass %KEYPASS% 2^>nul ^| findstr /c:"SHA1"') do (
  set "SHA1=%%B"
)
set "SHA1=!SHA1: =!"
echo.
echo       SHA-1:  !SHA1!
echo.
> "%ROOT%\SHA1_ANDROID.txt" (
  echo Pacchetto: io.github.turiddus.charactervault
  echo SHA-1:     !SHA1!
)
echo       Salvata anche in SHA1_ANDROID.txt

rem -------------------------------------------------------------- installazione facoltativa
set "ADB=%SDK%\platform-tools\adb.exe"
if not exist "%ADB%" goto :done
"%ADB%" start-server >nul 2>&1
set "DEVICE="
for /f "skip=1 tokens=1,2" %%A in ('call "%ADB%" devices') do if "%%B"=="device" set "DEVICE=%%A"
if not defined DEVICE goto :done
echo.
choice /c SN /m "Telefono collegato via USB: installare ora l'app"
if errorlevel 2 goto :done
"%ADB%" install -r "%ROOT%\CharacterVault.apk"

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

:java_missing
echo [ERRORE] Java non installato correttamente in "%JDK%"
goto :fail

:sdk_missing
echo [ERRORE] sdkmanager non trovato dopo l'estrazione degli strumenti Android.
goto :fail

:apk_missing
echo [ERRORE] APK non trovato: "%APK%"
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
if exist "%JDK%\bin\java.exe" set "JAVA_HOME=%JDK%"
if defined JAVA_HOME exit /b 0
if exist "%ProgramFiles%\Android\Android Studio\jbr\bin\java.exe" set "JAVA_HOME=%ProgramFiles%\Android\Android Studio\jbr"
exit /b 0

:download
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -UseBasicParsing -Uri '%~1' -OutFile '%~2'; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 (
  echo [ERRORE] Download non riuscito: %~1
  exit /b 1
)
exit /b 0

:unzip
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Expand-Archive -LiteralPath '%~1' -DestinationPath '%~2' -Force; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 (
  echo [ERRORE] Estrazione non riuscita: %~1
  exit /b 1
)
exit /b 0
