@echo off
setlocal
cd /d "%~dp0"

echo Cleaning generated files...

if exist "build-tmp" (
  echo - build-tmp
  rmdir /s /q "build-tmp"
)

if exist "manneung-classroom-offline.html" (
  echo - manneung-classroom-offline.html
  del /f /q "manneung-classroom-offline.html"
)

if exist "manneung-classroom.exe" (
  echo - manneung-classroom.exe
  del /f /q "manneung-classroom.exe"
)

if exist "desktop\app.html" (
  echo - desktop\app.html
  del /f /q "desktop\app.html"
)

echo Done.
endlocal
