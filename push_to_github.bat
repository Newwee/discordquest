@echo off
chcp 65001 >nul
title Push to GitHub - Discord Quest Auto
echo =======================================================
echo     🚀 Discord Quest Auto - Push Updates to GitHub
echo =======================================================
echo Repository: https://github.com/Newwee/discordquest
echo.

git status

echo.
set /p msg="ใส่ข้อความบันทึกการอัปเดต (Commit Message) [กด Enter ใช้ค่าเริ่มต้น]: "
if "%msg%"=="" set msg=Update Discord Quest Auto v2.3.0 - Auto Fake Game Spawner

echo.
echo กำลัง Add ไฟล์และ Commit...
git add .
git commit -m "%msg%"

echo.
echo กำลัง Push ไปยัง GitHub (origin main)...
git push -u origin main

echo.
if %errorlevel% equ 0 (
    echo =======================================================
    echo  ✅ Push อัปเดตขึ้น GitHub สำเร็จเรียบร้อยแล้ว!
    echo =======================================================
) else (
    echo =======================================================
    echo  ⚠️ มีข้อผิดพลาดในการ Push กรุณาตรวจสอบการเข้าสู่ระบบ GitHub
    echo =======================================================
)
echo.
pause
