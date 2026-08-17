@echo off
setlocal
cd /d "%~dp0"

set "CSC=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe"

echo [1/3] Copying offline HTML...
copy /Y "..\classdock-offline.html" "app.html" >nul
if errorlevel 1 (
  echo ^>^> Missing ..\classdock-offline.html. Run "node build-offline.js" first.
  exit /b 1
)

echo [2/3] Building exe...
if exist "%CSC%" (
  "%CSC%" /nologo /target:winexe /r:System.IO.Compression.dll /r:System.Security.dll /out:"..\ClassDock.exe" /resource:app.html,app.html /resource:python_kernel.py,python_kernel.py /resource:npm_package_runner.js,npm_package_runner.js "launcher.cs"
) else (
  echo ^>^> C# compiler not found; building Go fallback without PowerPoint PPTX-to-PDF conversion.
  go build -ldflags "-s -w -H=windowsgui" -o "..\ClassDock.exe" .
)
if errorlevel 1 (
  echo ^>^> Build failed.
  exit /b 1
)

echo [3/3] Done: ..\ClassDock.exe
endlocal
