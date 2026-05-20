@echo off
chcp 65001 > nul
title MJ Crawler - Unregister

reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.mj.crawler" /f
echo.
echo Unregistered. Restart Chrome.
echo (Also remove the extension at chrome://extensions if you want.)
pause
