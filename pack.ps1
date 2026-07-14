# 만능파일교실 - 빌드 후 테스트용 zip 만들기
# 실행: pack.bat 더블클릭 (또는 powershell -ExecutionPolicy Bypass -File pack.ps1)
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Fail($msg) {
  Write-Host ""
  Write-Host ">> $msg" -ForegroundColor Red
  Write-Host "*** 빌드/패키징이 중단되었습니다. ***" -ForegroundColor Red
  Read-Host "종료하려면 Enter"
  exit 1
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  만능파일교실 - 빌드 후 테스트용 zip 만들기" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# [0/4] 실행 중이면 exe 종료 (안 그러면 빌드가 파일을 못 덮어씀)
Get-Process manneung-classroom -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# [1/4] 오프라인 HTML 다시 인라인
Write-Host "[1/4] 오프라인 HTML 빌드 (node build-offline.js)..."
& node build-offline.js
if ($LASTEXITCODE -ne 0) { Fail "HTML 빌드 실패. node 가 설치돼 있는지 확인하세요." }

# [2/4] exe 재빌드
Write-Host "[2/4] exe 빌드 (desktop\build.bat)..."
& cmd /c "desktop\build.bat"
if ($LASTEXITCODE -ne 0) { Fail "exe 빌드 실패." }
if (-not (Test-Path "manneung-classroom.exe")) { Fail "exe 가 생성되지 않았습니다." }

# [3/4] 파일 모으기(스테이징) + 안내문 생성
Write-Host "[3/4] 파일 모으는 중..."
$stage = Join-Path $env:TEMP "mn-test-pack"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $stage "vendor\pyodide") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage "vendor\wheels")  | Out-Null

Copy-Item "manneung-classroom.exe" $stage
Copy-Item "vendor\pyodide\*" (Join-Path $stage "vendor\pyodide") -Recurse
Copy-Item "vendor\wheels\*"  (Join-Path $stage "vendor\wheels")  -Recurse

$readme = @"
만능파일교실 - 테스트용 패키지
================================

■ 실행 방법
  1. 이 zip을 아무 폴더에나 "압축 풀기" 하세요.
     (exe만 따로 빼내면 안 됩니다 - 옆의 vendor 폴더가 함께 있어야 파이썬이 오프라인으로 동작합니다.)
  2. manneung-classroom.exe 를 더블클릭하세요.
  3. 잠시 후 기본 브라우저에 앱 화면이 열립니다.

■ 폴더 구성
  manneung-classroom.exe   실행 파일 (앱 전체가 내장됨)
  vendor/pyodide/          인터넷 없이 파이썬을 돌리기 위한 코어
  vendor/wheels/           추가 파이썬 패키지 오프라인 설치용

■ 참고
  - 인터넷이 없어도 모든 기능이 동작하도록 만든 패키지입니다.
  - 처음 실행 시 Windows 보안 경고가 뜨면 "추가 정보 -> 실행"을 눌러주세요.
  - 파일은 외부로 전송되지 않고 모든 처리는 내 PC 안에서만 이뤄집니다.
"@
Set-Content -Path (Join-Path $stage "먼저읽어주세요.txt") -Value $readme -Encoding UTF8

# [4/4] 압축 (dist\만능파일교실-테스트-YYYY-MM-DD.zip)
Write-Host "[4/4] 압축 중..."
if (-not (Test-Path "dist")) { New-Item -ItemType Directory -Path "dist" | Out-Null }
$today = Get-Date -Format "yyyy-MM-dd"
$zip = "dist\만능파일교실-테스트-$today.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -CompressionLevel Optimal

Remove-Item $stage -Recurse -Force

$info = Get-Item $zip
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host ("  완료!  >>  {0}  ({1:N1} MB)" -f $info.FullName, ($info.Length / 1MB)) -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host "이 zip 하나만 전달하면 됩니다."
Write-Host ""
Read-Host "종료하려면 Enter"
