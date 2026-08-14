@echo off
chcp 65001 >nul
taskkill /IM ClassDock.exe /F >nul 2>&1
if errorlevel 1 (
  echo 실행 중인 ClassDock 서버가 없습니다.
) else (
  echo ClassDock 백그라운드 서버를 종료했습니다.
)
