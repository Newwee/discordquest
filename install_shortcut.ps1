# PowerShell Script to register Discord Quest Auto in Windows Search & Start Menu

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }

$startMenuDir = [Environment]::GetFolderPath('Programs')
$shortcutPath = Join-Path $startMenuDir "Discord Quest Auto.lnk"
$vbsPath = Join-Path $scriptDir "launch.vbs"
$iconPath = Join-Path $scriptDir "icon.ico"

Write-Host "Creating Windows Start Menu shortcut..." -ForegroundColor Cyan
Write-Host "Destination: $shortcutPath" -ForegroundColor Gray

$wshShell = New-Object -ComObject WScript.Shell
$shortcut = $wshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "wscript.exe"
$shortcut.Arguments = "`"$vbsPath`""
$shortcut.WorkingDirectory = $scriptDir
$shortcut.Description = "Discord Quest Auto WebApp"

# Set custom logo icon
if (Test-Path $iconPath) {
    $shortcut.IconLocation = "$iconPath,0"
}

$shortcut.Save()

# Also create shortcut on Desktop for instant 1-click access
$desktopDir = [Environment]::GetFolderPath('Desktop')
$desktopShortcutPath = Join-Path $desktopDir "Discord Quest Auto.lnk"
$desktopShortcut = $wshShell.CreateShortcut($desktopShortcutPath)
$desktopShortcut.TargetPath = "wscript.exe"
$desktopShortcut.Arguments = "`"$vbsPath`""
$desktopShortcut.WorkingDirectory = $scriptDir
$desktopShortcut.Description = "Discord Quest Auto WebApp"
if (Test-Path $iconPath) {
    $desktopShortcut.IconLocation = "$iconPath,0"
}
$desktopShortcut.Save()

Write-Host "`n[SUCCESS] Registered Logo & Shortcuts in Windows Start Menu and Desktop!" -ForegroundColor Green
Write-Host "You can now press the Windows Key and search for: 'Discord Quest Auto'" -ForegroundColor Yellow
