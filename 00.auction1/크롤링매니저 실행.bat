@echo off
chcp 65001 > nul
title MJ 크롤링 매니저
echo.
echo  ====================================================
echo    MJ 크롤링 매니저 시작
echo    http://localhost:8765
echo  ====================================================
echo.
cd /d "C:\LJW\01. SYSTEM\MAPS_TEST\00.auction1"

REM Chrome 으로 열기 (설치 경로 자동 탐지)
set "CHROME_EXE="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if defined CHROME_EXE (
    start "" "%CHROME_EXE%" "http://localhost:8765"
) else (
    echo  [경고] Chrome 을 찾을 수 없어 기본 브라우저로 엽니다.
    start "" "http://localhost:8765"
)

python -u crawler.py
echo.
echo  서버가 종료되었습니다.
pause
