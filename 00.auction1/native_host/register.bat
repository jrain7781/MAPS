@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion
title MJ Crawler - Chrome Extension Register

echo.
echo  ==========================================================
echo    MJ Crawler - Chrome Native Messaging Host Register
echo  ==========================================================
echo.
echo  [BEFORE THIS]
echo    1. Open Chrome and go to: chrome://extensions
echo    2. Toggle ON "Developer mode" (top right)
echo    3. Click "Load unpacked"
echo    4. Select this folder:
echo       C:\LJW\01. SYSTEM\MAPS_TEST\00.auction1\chrome_ext
echo    5. Copy the 32-character extension ID shown on the card
echo.

set /p EXT_ID=Paste extension ID and press Enter: 

if "%EXT_ID%"=="" (
    echo.
    echo  [ERROR] ID is empty.
    pause
    exit /b 1
)

set "HOST_DIR=%~dp0"
set "MANIFEST=%HOST_DIR%com.mj.crawler.json"
set "LAUNCHER=%HOST_DIR%crawler_launcher.bat"

powershell -NoProfile -Command "$obj = [ordered]@{ name='com.mj.crawler'; description='MJ Crawler Native Host'; path='%LAUNCHER%'; type='stdio'; allowed_origins=@('chrome-extension://%EXT_ID%/') }; $obj | ConvertTo-Json -Depth 5 | Out-File -FilePath '%MANIFEST%' -Encoding utf8"

if not exist "%MANIFEST%" (
    echo  [ERROR] Failed to create manifest.
    pause
    exit /b 1
)

echo.
echo  [OK] Manifest: %MANIFEST%
echo.

reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.mj.crawler" /ve /t REG_SZ /d "%MANIFEST%" /f > nul
if errorlevel 1 (
    echo  [ERROR] Registry write failed.
    pause
    exit /b 1
)

echo  [OK] Registry registered.
echo.
echo  ==========================================================
echo    NEXT:
echo    1. Fully quit Chrome and restart
echo    2. Click MJ extension icon in toolbar
echo    3. Crawler server starts + new tab opens automatically
echo  ==========================================================
echo.
pause
