# Character Vault Android release signing preflight.
# Never replaces an existing keystore or guesses-and-overwrites its password.
# Uses keytool to verify BOTH the keystore password and the private-key password.
param(
    [Parameter(Mandatory=$true)][string]$SourceApp,
    [Parameter(Mandatory=$true)][string]$WorkApp,
    [Parameter(Mandatory=$true)][string]$Keytool
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-SigningProperties([string]$File) {
    $values = @{}
    $encoded = @{}
    if (Test-Path -LiteralPath $File -PathType Leaf) {
        foreach ($line in [IO.File]::ReadAllLines($File)) {
            if ($line -match '^\s*(storePassword|keyPassword|keyAlias)\s*[=:]\s*(.*)$') {
                # Legacy keystore.properties format.
                $values[$matches[1]] = $matches[2]
            } elseif ($line -match '^\s*(storePasswordBase64|keyPasswordBase64|keyAliasBase64)\s*[=:]\s*(.*)$') {
                $encoded[$matches[1]] = $matches[2]
            }
        }
        # New format stores UTF-8 bytes as Base64 so Java/Gradle Properties never
        # alter special characters in private-key credentials. It is NOT encryption.
        foreach ($name in @('storePassword', 'keyPassword', 'keyAlias')) {
            if ($encoded.ContainsKey($name + 'Base64')) {
                try {
                    $values[$name] = [Text.Encoding]::UTF8.GetString(
                        [Convert]::FromBase64String($encoded[$name + 'Base64']))
                } catch { throw ('Invalid saved signing data: ' + $name + 'Base64') }
            }
        }
    }
    return $values
}
function Add-Unique([System.Collections.ArrayList]$List, [string]$Value) {
    if ($null -ne $Value -and $Value.Length -gt 0 -and -not $List.Contains($Value)) {
        [void]$List.Add($Value)
    }
}
function Test-SigningIdentity([string]$File, [string]$Alias, [string]$StorePass, [string]$KeyPass) {
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('cv_sign_check_' + [guid]::NewGuid().ToString('N') + '.csr')
    $previousErrorAction = $ErrorActionPreference
    try {
        # Java keytool may emit harmless warnings on stderr for legacy JKS files.
        $ErrorActionPreference = 'Continue'
        $env:CV_SIGN_CHECK_STORE = $StorePass
        $env:CV_SIGN_CHECK_KEY = $KeyPass
        # A CSR can only be generated if the selected alias and *private key* decrypt.
        # This does NOT modify the keystore and never exports the private key.
        $null = & $Keytool -certreq -keystore $File -alias $Alias `
            -storepass:env CV_SIGN_CHECK_STORE -keypass:env CV_SIGN_CHECK_KEY -file $tmp 2>&1
        return ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $tmp))
    } catch { return $false }
    finally {
        $ErrorActionPreference = $previousErrorAction
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
        Remove-Item Env:CV_SIGN_CHECK_STORE -ErrorAction SilentlyContinue
        Remove-Item Env:CV_SIGN_CHECK_KEY -ErrorAction SilentlyContinue
    }
}
function To-Base64([string]$Value) {
    return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Value))
}
function Save-SigningProperties([string]$File, [string]$Alias, [string]$StorePass, [string]$KeyPass) {
    if (Test-Path -LiteralPath $File) {
        $stamp = Get-Date -Format 'yyyyMMdd_HHmmss_fff'
        Copy-Item -LiteralPath $File -Destination ($File + '.backup_' + $stamp) -ErrorAction Stop
    }
    # Never pass a signing password through CMD, where !, &, ^ and % can change it.
    # The Java/Gradle reader decodes these Base64 fields as UTF-8.
    $encodedStore = To-Base64 $StorePass
    $encodedAlias = To-Base64 $Alias
    $encodedKey = To-Base64 $KeyPass
    $content = "storeFile=charactervault.jks`r`n" +
               "signingFormat=base64-utf8`r`n" +
               "storePasswordBase64=$encodedStore`r`n" +
               "keyAliasBase64=$encodedAlias`r`n" +
               "keyPasswordBase64=$encodedKey`r`n"
    [IO.File]::WriteAllText($File, $content, (New-Object System.Text.UTF8Encoding($false)))
}

try {
    if (-not (Test-Path -LiteralPath $Keytool -PathType Leaf)) { throw 'keytool.exe is missing.' }
    if (-not (Test-Path -LiteralPath $SourceApp -PathType Container)) { throw 'Source android_app is missing.' }
    if (-not (Test-Path -LiteralPath $WorkApp -PathType Container)) { New-Item -ItemType Directory -Path $WorkApp -Force | Out-Null }
    $sourceKey = Join-Path $SourceApp 'charactervault.jks'
    $workKey = Join-Path $WorkApp 'charactervault.jks'
    $sourceProperties = Join-Path $SourceApp 'keystore.properties'
    $workProperties = Join-Path $WorkApp 'keystore.properties'
    $propsSource = Get-SigningProperties $sourceProperties
    $propsWork = Get-SigningProperties $workProperties
    # New-key creation writes these recovery credentials BEFORE invoking keytool.
    # If Windows closes between creation and saving final properties, the new key
    # remains recoverable. The recovery file is as sensitive as keystore.properties.
    $recoveryFile = $sourceProperties + '.creation-recovery'
    if (-not $propsSource.ContainsKey('storePassword') -and
            (Test-Path -LiteralPath $recoveryFile -PathType Leaf)) {
        $recovery = Get-SigningProperties $recoveryFile
        if ($recovery.ContainsKey('storePassword')) {
            $propsSource = $recovery
            Write-Host '[SIGNING] Found recoverable credentials from an interrupted key creation.' -ForegroundColor Yellow
        }
    }
    $stores = New-Object System.Collections.ArrayList
    if (Test-Path -LiteralPath $sourceKey -PathType Leaf) { [void]$stores.Add($sourceKey) }
    if (Test-Path -LiteralPath $workKey -PathType Leaf) { [void]$stores.Add($workKey) }

    if ($stores.Count -eq 0) {
        Write-Host '[SIGNING] No existing signing key was found.' -ForegroundColor Yellow
        Write-Host '[SIGNING] A new signing key CANNOT update an app signed with the old key.' -ForegroundColor Yellow
        $choice = Read-Host 'Type CREATE (any letter case) ONLY for a fresh Android installation (otherwise Enter to stop)'
        if ($null -eq $choice -or $choice.Trim() -ne 'CREATE') { throw 'Build cancelled. Recover charactervault.jks from the original project or backups.' }
        Write-Host '[SIGNING] Fresh-install key creation explicitly authorized. This key cannot update an app signed with another key.' -ForegroundColor Yellow
        $bytes = New-Object byte[] 24
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $password = [Convert]::ToBase64String($bytes)
        # Persist credentials first. If Windows is closed after keytool creates
        # the JKS but before the normal save, they can be recovered next time.
        Save-SigningProperties $recoveryFile 'vault' $password $password
        $env:CV_SIGN_NEW_KEY_PASSWORD = $password
        try {
            # On Windows PowerShell 5.1 a *successful* localized keytool writes
            # progress to stderr. With ErrorActionPreference=Stop this becomes a
            # terminating NativeCommandError, even when the process exits 0.
            # Trust the process EXIT CODE, not whether Java emitted stderr.
            $previousErrorAction = $ErrorActionPreference
            try {
                $ErrorActionPreference = 'Continue'
                $null = & $Keytool -genkeypair -keystore $sourceKey -alias vault `
                    -storepass:env CV_SIGN_NEW_KEY_PASSWORD -keypass:env CV_SIGN_NEW_KEY_PASSWORD `
                    -keyalg RSA -keysize 2048 -validity 36500 -dname 'CN=Character Vault, O=turiddus' 2>&1
                $generatedExitCode = $LASTEXITCODE
            } finally { $ErrorActionPreference = $previousErrorAction }
            if ($generatedExitCode -ne 0 -or -not (Test-Path -LiteralPath $sourceKey -PathType Leaf)) {
                throw ('keytool failed to create the keystore (exit code ' + $generatedExitCode + '). Recovery credentials were retained.')
            }
        } finally { Remove-Item Env:CV_SIGN_NEW_KEY_PASSWORD -ErrorAction SilentlyContinue }
        [void]$stores.Add($sourceKey)
        $propsSource['storePassword'] = $password
        $propsSource['keyPassword'] = $password
        $propsSource['keyAlias'] = 'vault'
    }

    if ($stores.Count -eq 2 -and (Get-FileHash -LiteralPath $sourceKey -Algorithm SHA256).Hash -ne
                              (Get-FileHash -LiteralPath $workKey -Algorithm SHA256).Hash) {
        Write-Host '[SIGNING] WARNING: source and C:\CVBuild contain DIFFERENT signing keys.' -ForegroundColor Yellow
        Write-Host '[SIGNING] The original key is essential to update the app already on your phone.'
    }

    $aliases = New-Object System.Collections.ArrayList
    Add-Unique $aliases $propsSource['keyAlias']
    Add-Unique $aliases $propsWork['keyAlias']
    Add-Unique $aliases 'vault'
    $passwords = New-Object System.Collections.ArrayList
    Add-Unique $passwords $propsSource['storePassword']
    Add-Unique $passwords $propsWork['storePassword']
    Add-Unique $passwords $env:CV_ANDROID_KEY_PASSWORD
    Add-Unique $passwords 'charactervault' # legacy helper only; validated before use
    $keyPasswords = New-Object System.Collections.ArrayList
    Add-Unique $keyPasswords $propsSource['keyPassword']
    Add-Unique $keyPasswords $propsWork['keyPassword']
    Add-Unique $keyPasswords $env:CV_ANDROID_KEY_PASSWORD

    $found = $null
    foreach ($store in $stores) {
        foreach ($pass in $passwords) {
            foreach ($alias in $aliases) {
                $options = New-Object System.Collections.ArrayList
                foreach ($kp in $keyPasswords) { Add-Unique $options $kp }
                Add-Unique $options $pass
                foreach ($kp in $options) {
                    if (Test-SigningIdentity $store $alias $pass $kp) {
                        $found = @{ Store = $store; StorePass = $pass; KeyPass = $kp; Alias = $alias }
                        break
                    }
                }
                if ($null -ne $found) { break }
            }
            if ($null -ne $found) { break }
        }
        if ($null -ne $found) { break }
    }

    if ($null -eq $found) {
        Write-Host '[SIGNING] No saved password can unlock the private key.' -ForegroundColor Yellow
        Write-Host '[SIGNING] Nothing has been overwritten. You may enter your old signing password locally.'
        for ($i=1; $i -le 3 -and $null -eq $found; $i++) {
            $secureStore = Read-Host 'Keystore password (input hidden; Enter to cancel)' -AsSecureString
            $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureStore)
            try { $pass = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
            finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
            if ([string]::IsNullOrEmpty($pass)) { break }
            foreach ($store in $stores) {
                foreach ($alias in $aliases) {
                    $options = New-Object System.Collections.ArrayList
                    Add-Unique $options $propsSource['keyPassword']
                    Add-Unique $options $propsWork['keyPassword']
                    Add-Unique $options $pass
                    foreach ($kp in $options) {
                        if (Test-SigningIdentity $store $alias $pass $kp) {
                            $found = @{ Store=$store; StorePass=$pass; KeyPass=$kp; Alias=$alias }
                            break
                        }
                    }
                    if ($null -ne $found) { break }
                }
                if ($null -ne $found) { break }
            }
            if ($null -eq $found) { Write-Host '[SIGNING] Password or key password did not match.' -ForegroundColor Yellow }
        }
    }
    if ($null -eq $found) { throw 'Signing identity not recovered. Find the OLD matching charactervault.jks and keystore.properties. No new key was created.' }
    if ((Test-Path -LiteralPath $sourceKey) -and (Test-Path -LiteralPath $workKey) -and
         (Get-FileHash -LiteralPath $sourceKey -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $workKey -Algorithm SHA256).Hash -and
         $found.Store -eq $workKey) {
        Write-Host '[SIGNING] The verified key is the WORK copy, not the source copy.' -ForegroundColor Yellow
        $choice = Read-Host 'Type USE-WORK to preserve the verified WORK key as your signing identity (otherwise Enter to stop)'
        if ($choice -cne 'USE-WORK') { throw 'Source/work keys differ. Keep both untouched until you identify the key from your currently installed app.' }
        Copy-Item -LiteralPath $sourceKey -Destination ($sourceKey + '.before_work_recovery_' + (Get-Date -Format 'yyyyMMdd_HHmmss_fff'))
    }

    # Commit only *after* successful private-key verification.
    if ($found.Store -ne $sourceKey) { Copy-Item -LiteralPath $found.Store -Destination $sourceKey -Force }
    if ($found.Store -ne $workKey) { Copy-Item -LiteralPath $sourceKey -Destination $workKey -Force }
    Save-SigningProperties $sourceProperties $found.Alias $found.StorePass $found.KeyPass
    Save-SigningProperties $workProperties $found.Alias $found.StorePass $found.KeyPass
    $env:CV_SIGN_VERIFIED_STORE = $found.StorePass
    try {
        $oldEap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $fingerprint = & $Keytool -list -v -keystore $sourceKey -alias $found.Alias -storepass:env CV_SIGN_VERIFIED_STORE 2>&1
            $keytoolExit = $LASTEXITCODE
        } finally { $ErrorActionPreference = $oldEap }
        if ($keytoolExit -ne 0) { throw 'Unable to read signing fingerprint.' }
        $match = [regex]::Match(($fingerprint -join "`n"), 'SHA1:\s*([0-9A-Fa-f:]+)')
        if (-not $match.Success) { throw 'SHA-1 fingerprint not found.' }
        $sha1 = $match.Groups[1].Value
        $shaFile = Join-Path (Split-Path -Parent $SourceApp) 'SHA1_ANDROID.txt'
        [IO.File]::WriteAllText($shaFile,
            "Package: io.github.turiddus.charactervault`r`nSHA-1: $sha1`r`n",
            (New-Object System.Text.UTF8Encoding($false)))
    } finally { Remove-Item Env:CV_SIGN_VERIFIED_STORE -ErrorAction SilentlyContinue }
    Write-Host '[SIGNING] Original signing private key validated successfully.' -ForegroundColor Green
    Write-Host '[SIGNING] Password/alias checked without displaying the credentials.'
    # The final properties are now stored in both locations and verified.
    # Keep the recovery file if anything above fails for safe troubleshooting.
    if (Test-Path -LiteralPath $recoveryFile -PathType Leaf) {
        Remove-Item -LiteralPath $recoveryFile -Force -ErrorAction SilentlyContinue
    }
    Write-Host ('[SIGNING] SHA-1: ' + $sha1)
    exit 0
} catch {
    Write-Host ('[SIGNING ERROR] ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
