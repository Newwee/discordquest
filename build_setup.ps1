$ErrorActionPreference = "Stop"

Write-Host "Creating payload..."
$targetDir = Join-Path $PSScriptRoot "temp_build"
if (Test-Path $targetDir) { Remove-Item -Recurse -Force $targetDir }
New-Item -ItemType Directory -Path $targetDir | Out-Null

$filesToInclude = @(
    "server.js",
    "license_gate.js",
    "token_extractor.js",
    "fake_game_spawner.js",
    "dummy_stub.exe",
    "dummy_game.cs",
    "version.json",
    "launch.vbs",
    "start.bat",
    "install_shortcut.ps1",
    "icon.ico"
)

foreach ($f in $filesToInclude) {
    Copy-Item (Join-Path $PSScriptRoot $f) -Destination $targetDir
}

# Copy clean default config
Copy-Item (Join-Path $PSScriptRoot "config.example.json") -Destination (Join-Path $targetDir "config.json")

# Copy public folder
Copy-Item -Recurse (Join-Path $PSScriptRoot "public") -Destination $targetDir

$payloadZip = Join-Path $PSScriptRoot "payload.zip"
if (Test-Path $payloadZip) { Remove-Item -Force $payloadZip }

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($targetDir, $payloadZip)
Remove-Item -Recurse -Force $targetDir

Write-Host "Compiling Setup.exe with csc.exe..."
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$setupCs = Join-Path $PSScriptRoot "Setup.cs"
$setupExe = Join-Path $PSScriptRoot "Setup.exe"
$iconPath = Join-Path $PSScriptRoot "icon.ico"

$argList = @(
    "/target:winexe",
    "/r:System.dll",
    "/r:System.Core.dll",
    "/r:System.Windows.Forms.dll",
    "/r:System.Drawing.dll",
    "/r:System.IO.Compression.dll",
    "/r:System.IO.Compression.FileSystem.dll",
    "/win32icon:`"$iconPath`"",
    "/resource:`"$payloadZip`",payload.zip",
    "/out:`"$setupExe`"",
    "`"$setupCs`""
)

$proc = Start-Process -FilePath $csc -ArgumentList $argList -NoNewWindow -Wait -PassThru
if ($proc.ExitCode -ne 0) {
    throw "CSC Compilation failed with exit code $($proc.ExitCode)"
}

Write-Host "Setup.exe compiled successfully!"

# Sign Setup.exe with Authenticode Signature
try {
    Write-Host "Signing Setup.exe with Authenticode Signature..."
    $existingCert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Subject -match "J3A Software Solutions" } | Select-Object -First 1
    if ($null -eq $existingCert) {
        $existingCert = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=J3A Software Solutions" -CertStoreLocation "Cert:\CurrentUser\My" -NotAfter (Get-Date).AddYears(5)
    }
    if ($null -ne $existingCert) {
        Set-AuthenticodeSignature -FilePath $setupExe -Certificate $existingCert | Out-Null
        Write-Host "Setup.exe digitally signed as 'J3A Software Solutions'!"
    }
} catch {
    Write-Warning "Could not sign executable: $($_.Exception.Message)"
}

# Remove temporary payload.zip
Remove-Item -Force $payloadZip

# Package DiscordQuestAuto_Setup.zip
Write-Host "Packaging DiscordQuestAuto_Setup.zip..."
$distZip = Join-Path $PSScriptRoot "DiscordQuestAuto_Setup.zip"
if (Test-Path $distZip) { Remove-Item -Force $distZip }

$zipDir = Join-Path $PSScriptRoot "temp_dist"
if (Test-Path $zipDir) { Remove-Item -Recurse -Force $zipDir }
New-Item -ItemType Directory -Path $zipDir | Out-Null

Copy-Item $setupExe -Destination $zipDir
Copy-Item (Join-Path $PSScriptRoot "README.txt") -Destination $zipDir

[System.IO.Compression.ZipFile]::CreateFromDirectory($zipDir, $distZip)
Remove-Item -Recurse -Force $zipDir

Write-Host "Build complete! DiscordQuestAuto_Setup.zip is ready."
