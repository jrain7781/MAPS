@echo off
setlocal enabledelayedexpansion
chcp 65001
cd /d "%~dp0"
set "LIST_DIR=건별 캡쳐 리스트"
rem 이미지캡쳐로 받는 파일명만 대상: YYYYMMDDHHMMSS.txt (숫자 14자리) - README.txt 제외
set "NEWEST="
for /f "delims=" %%F in ('powershell -NoProfile -Command "Get-ChildItem -LiteralPath \"%LIST_DIR%\" -Filter '*.txt' -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^\d{14}\.txt$' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName" 2^>nul') do set "NEWEST=%%F"
if not defined NEWEST (
  echo [건변등록] 건별 캡쳐 리스트 폴더에 리스트 파일이 없습니다.
  echo   대상: 숫자 14자리.txt 형식 ^(예: 20260130151022.txt^) - README.txt 등은 제외됩니다.
  pause
  exit /b 1
)
echo [건변등록] 최신 리스트 파일: !NEWEST!
python "%~dp003.k.py" "!NEWEST!"
pause
