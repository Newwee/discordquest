@echo off
title Discord Quest Auto
cd /d "%~dp0"
echo ===================================================
echo           DISCORD QUEST AUTO SERVER
echo ===================================================
echo [!] Starting Node.js server at http://localhost:4545...
echo.

start "" wscript.exe "%~dp0launch.vbs"

echo [OK] WebApp launched in application mode!
echo Press any key to exit this window or keep open.
pause
