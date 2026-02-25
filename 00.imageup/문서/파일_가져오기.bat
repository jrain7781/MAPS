@echo off
chcp 65001 >nul
setlocal

rem ----- 예전 경로(한글) → 00.imageup 으로 파일 복사 -----
set "OLD_PATH=C:\Users\MJ경매-이쁜언니\Desktop\ljw\02. 업무\00. 자동화\00. 파이썬"
set "NEW_PATH=C:\LJW\MAPS_TEST\00.imageup"

echo [파일 가져오기] 예전 경로 → 00.imageup
echo.
echo   원본: %OLD_PATH%
echo   대상: %NEW_PATH%
echo.

if not exist "%OLD_PATH%" (
    echo [오류] 예전 경로가 없습니다. 경로를 확인하세요.
    goto :pause
)

echo 복사 중...
xcopy "%OLD_PATH%\*.*" "%NEW_PATH%\" /E /I /Y /Q
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if %EXIT_CODE% equ 0 (
    echo [완료] 파일을 가져왔습니다. 이제 경매자동화.bat 을 실행하세요.
) else (
    echo [오류] 복사 중 문제가 발생했습니다. 코드: %EXIT_CODE%
)

:pause
echo.
pause
endlocal
