@echo off
setlocal
cd /d "%~dp0"

echo Cleaning generated files...

if exist "build-tmp" (
  echo - build-tmp
  rmdir /s /q "build-tmp"
)

if exist "classdock-offline.html" (
  echo - classdock-offline.html
  del /f /q "classdock-offline.html"
)

if exist "ClassDock.exe" (
  echo - ClassDock.exe
  del /f /q "ClassDock.exe"
)

if exist "desktop\app.html" (
  echo - desktop\app.html
  del /f /q "desktop\app.html"
)

echo Done.
endlocal
