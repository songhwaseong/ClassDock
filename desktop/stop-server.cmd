@echo off
chcp 65001 >nul
taskkill /IM manneung-classroom.exe /F >nul 2>&1
if errorlevel 1 (
  echo 실행 중인 PDF Signer 서버가 없습니다.
) else (
  echo PDF Signer 백그라운드 서버를 종료했습니다.
)
