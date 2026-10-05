# ClassDock - 빌드 후 테스트용 zip 만들기
# 실행: pack.bat 더블클릭 (또는 powershell -ExecutionPolicy Bypass -File pack.ps1)
#
# 인터넷 없는 PC 에서도 쓰게 하려면 아래 셋을 함께 담을 수 있다(더블클릭하면 하나씩 묻는다).
#   -Ffmpeg    exe 옆 ffmpeg.exe      영상 변환 (약 100MB)
#   -JavaLibs  vendor\java-libs\      앱에서 받아 둔 자바 라이브러리 jar
#   -Jdk       jdk\                   자바 실행·채점용 JDK 21 (압축 약 200MB, 풀면 약 330MB)
#   -Full      셋 다 / -Lite 셋 다 빼기(묻지 않음)
# 예: pack.bat -Full
#
# 버전: 번호는 package.json 의 "version" 한 곳에 있다. 빌드한 앱 내용의 지문을 지난 배포 기록(release.json)과
# 비교해 같으면 그대로 두고, 바뀌었으면 올릴지 묻는다(스위치를 줘서 묻지 않을 때는 끝자리를 자동으로 올린다).
#   -Version 1.2.0   번호를 직접 정하기
param(
  [switch]$Ffmpeg,
  [switch]$JavaLibs,
  [switch]$Jdk,
  [switch]$Full,
  [switch]$Lite,
  [string]$Version
)
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

function AskYesNo($question) {
  $answer = Read-Host "$question [y/N]"
  return ($answer -match '^(y|yes|ㅛ|예|네)$')
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  ClassDock - 빌드 후 테스트용 zip 만들기" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# 담을 것 고르기 — 스위치를 하나라도 줬으면 묻지 않는다
$ffmpegSrc = Join-Path $PSScriptRoot "ffmpeg.exe"
$javaLibsSrc = Join-Path $PSScriptRoot "java-libs"
if ($Full) { $Ffmpeg = $true; $JavaLibs = $true; $Jdk = $true }
$interactive = -not ($Full -or $Lite -or $Ffmpeg -or $JavaLibs -or $Jdk)
if ($Version -and $Version -notmatch '^\d+\.\d+\.\d+$') { Fail "버전은 1.2.3 모양이어야 합니다: $Version" }
if ($interactive) {
  Write-Host "인터넷 없는 PC 에서도 쓰게 하려면 아래를 함께 담으세요. (안 담아도 인터넷이 있으면 앱이 처음 쓸 때 받습니다)"
  if (Test-Path $ffmpegSrc) {
    $Ffmpeg = AskYesNo "  ffmpeg (영상 변환, 약 100MB) 담을까요?"
  } else {
    Write-Host "  - ffmpeg.exe 가 이 폴더에 없어 건너뜁니다. (앱에서 한 번 설치하면 여기 생깁니다)" -ForegroundColor DarkGray
  }
  if (Test-Path $javaLibsSrc) {
    $JavaLibs = AskYesNo "  받아 둔 자바 라이브러리(java-libs) 담을까요?"
  }
  $Jdk = AskYesNo "  JDK 21 (자바 실행·채점, 압축 약 200MB) 담을까요?"
  Write-Host ""
}
if ($Ffmpeg -and -not (Test-Path $ffmpegSrc)) { Fail "ffmpeg.exe 가 없습니다: $ffmpegSrc  (앱에서 ffmpeg 를 한 번 설치하면 exe 옆에 생깁니다)" }
if ($JavaLibs -and -not (Test-Path $javaLibsSrc)) { Write-Host "java-libs 폴더가 없어 자바 라이브러리는 건너뜁니다." -ForegroundColor Yellow; $JavaLibs = $false }

# [0/5] 실행 중이면 exe 종료 (안 그러면 빌드가 파일을 못 덮어씀)
Get-Process classdock -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# [1/5] 오프라인 HTML 다시 인라인
Write-Host "[1/5] 오프라인 HTML 빌드 (node build-offline.js)..."
& node tools/build-third-party-notices.mjs
if ($LASTEXITCODE -ne 0) { Fail "오픈소스 라이선스 고지(THIRD_PARTY_NOTICES.txt) 생성 실패." }
& node build-offline.js
if ($LASTEXITCODE -ne 0) { Fail "HTML 빌드 실패. node 가 설치돼 있는지 확인하세요." }

# 버전 정하기 — 앱 내용의 지문(빌드 날짜·커밋은 뺀 것)을 지난 배포와 비교한다
$statusJson = & node tools/release.js status
if ($LASTEXITCODE -ne 0) { Fail "버전 정보를 읽지 못했습니다 (package.json 의 version 확인)." }
$status = $statusJson | ConvertFrom-Json
$current = $status.version
$appVersion = $current
if ($Version) {
  $appVersion = $Version
  Write-Host "      버전: $appVersion (직접 지정)"
} elseif (-not $status.last) {
  Write-Host "      첫 배포 기록입니다. 버전: $current"
} elseif ($status.fingerprint -eq $status.last.fingerprint) {
  Write-Host "      지난 배포($($status.last.version), $($status.last.date))와 앱 내용이 같습니다. 버전: $current 그대로"
} elseif ($current -ne $status.last.version) {
  Write-Host "      앱 내용이 바뀌었고 번호는 이미 $current 로 정해 두었습니다."
} else {
  $patchVersion = (& node tools/release.js next patch).Trim()
  $minorVersion = (& node tools/release.js next minor).Trim()
  if ($interactive) {
    Write-Host ""
    Write-Host "  지난 배포($current, $($status.last.date)) 뒤로 앱 내용이 바뀌었습니다. 버전을 고르세요."
    Write-Host "    [1] $patchVersion   고침 (기본)"
    Write-Host "    [2] $minorVersion   기능 추가"
    Write-Host "    [3] $current   그대로"
    Write-Host "    또는 1.2.3 처럼 직접 입력"
    $pick = (Read-Host "  번호 [1]").Trim()
    if ($pick -eq "2") { $appVersion = $minorVersion }
    elseif ($pick -eq "3") { $appVersion = $current }
    elseif ($pick -match '^\d+\.\d+\.\d+$') { $appVersion = $pick }
    else { $appVersion = $patchVersion }
    Write-Host ""
  } else {
    $appVersion = $patchVersion
    Write-Host "      앱 내용이 바뀌어 버전을 $appVersion 으로 올립니다 (직접 정하려면 -Version)."
  }
}
if ($appVersion -ne $current) {
  & node tools/release.js set-version $appVersion
  if ($LASTEXITCODE -ne 0) { Fail "package.json 버전을 바꾸지 못했습니다." }
  Write-Host "      package.json 버전: $current -> $appVersion. 새 번호로 HTML 을 다시 빌드합니다..."
  & node build-offline.js
  if ($LASTEXITCODE -ne 0) { Fail "HTML 빌드 실패." }
}

# [2/5] exe 재빌드
Write-Host "[2/5] exe 빌드 (desktop\build.bat)..."
& cmd /c "desktop\build.bat"
if ($LASTEXITCODE -ne 0) { Fail "exe 빌드 실패." }
if (-not (Test-Path "ClassDock.exe")) { Fail "exe 가 생성되지 않았습니다." }

# [3/5] JDK 받기 — 앱의 자동 설치와 같은 배포처(Adoptium)·같은 체크섬 확인. 받은 zip 은 dist\cache 에 두고 다시 쓴다.
$jdkZip = $null
$jdkRelease = ""
if ($Jdk) {
  Write-Host "[3/5] JDK 21 준비 (Adoptium)..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $ProgressPreference = "SilentlyContinue"   # 진행 막대를 그리면 Invoke-WebRequest 가 몇 배 느려진다
  $cacheDir = Join-Path $PSScriptRoot "dist\cache"
  if (-not (Test-Path $cacheDir)) { New-Item -ItemType Directory -Path $cacheDir | Out-Null }
  try {
    $meta = Invoke-RestMethod -UseBasicParsing -Headers @{ "User-Agent" = "ClassDock" } `
      -Uri "https://api.adoptium.net/v3/assets/latest/21/hotspot?os=windows&architecture=x64&image_type=jdk&vendor=eclipse"
  } catch { Fail "JDK 정보를 받지 못했습니다(인터넷 연결 확인): $($_.Exception.Message)" }
  $asset = @($meta)[0]
  $pkg = $asset.binary.package
  if (-not $pkg -or -not $pkg.link -or -not $pkg.checksum -or $pkg.link -notmatch '^https://.+\.zip$') { Fail "JDK 배포처 응답을 이해하지 못했습니다." }
  $jdkRelease = $asset.release_name
  $jdkZip = Join-Path $cacheDir $pkg.name
  $cachedOk = (Test-Path $jdkZip) -and ((Get-FileHash $jdkZip -Algorithm SHA256).Hash -ieq $pkg.checksum)
  if ($cachedOk) {
    Write-Host "      받아 둔 $($pkg.name) 을 씁니다."
  } else {
    Write-Host ("      {0} 받는 중 ({1:N0} MB)..." -f $pkg.name, ($pkg.size / 1MB))
    try { Invoke-WebRequest -UseBasicParsing -Uri $pkg.link -OutFile $jdkZip } catch { Fail "JDK 다운로드 실패: $($_.Exception.Message)" }
    if ((Get-FileHash $jdkZip -Algorithm SHA256).Hash -ine $pkg.checksum) {
      Remove-Item $jdkZip -Force -ErrorAction SilentlyContinue
      Fail "받은 JDK 의 검증값이 맞지 않습니다. 다시 실행해 보세요."
    }
  }
} else {
  Write-Host "[3/5] JDK 는 담지 않습니다."
}

# [4/5] 파일 모으기(스테이징) + 안내문 생성
Write-Host "[4/5] 파일 모으는 중..."
$stage = Join-Path $env:TEMP "mn-test-pack"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $stage "vendor\pyodide") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage "vendor\wheels")  | Out-Null

Copy-Item "ClassDock.exe" $stage
Copy-Item "vendor\pyodide\*" (Join-Path $stage "vendor\pyodide") -Recurse
Copy-Item "vendor\wheels\*"  (Join-Path $stage "vendor\wheels")  -Recurse
Copy-Item "docs\API-인증키-안내.md" (Join-Path $stage "API-인증키-안내.md")
# 앱에 들어간 오픈소스의 라이선스 전문·저작자 표시 — 배포본에 반드시 함께 실어야 한다
Copy-Item "THIRD_PARTY_NOTICES.txt" $stage

# 런처가 찾는 자리: ffmpeg=exe 옆, jar=vendor\java-libs(배포본 전용 조회 자리), JDK=exe 옆 jdk\<한 겹>\bin\java.exe
if ($Ffmpeg) {
  Copy-Item $ffmpegSrc $stage
  # ffmpeg.exe(gyan.dev essentials 빌드)는 GPL-3.0 이라, 함께 배포할 때는 라이선스 전문과 소스 위치를 옆에 둔다
  $ffmpegNotice = "ffmpeg.exe 는 FFmpeg 프로젝트(https://ffmpeg.org)의 프로그램으로, gyan.dev 의 공식 Windows 빌드`r`n" +
    "(ffmpeg-release-essentials)를 고치지 않고 그대로 담았습니다. GPL-3.0 으로 배포되며 전문은 아래와 같습니다.`r`n" +
    "소스 코드: https://ffmpeg.org/download.html · 빌드 정보: https://www.gyan.dev/ffmpeg/builds/`r`n`r`n"
  $gpl = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot "vendor\licenses\ffmpeg-GPLv3.txt"))
  [System.IO.File]::WriteAllText((Join-Path $stage "ffmpeg-LICENSE.txt"), $ffmpegNotice + $gpl, (New-Object System.Text.UTF8Encoding $true))
}
if ($JavaLibs) {
  New-Item -ItemType Directory -Path (Join-Path $stage "vendor\java-libs") | Out-Null
  Copy-Item (Join-Path $javaLibsSrc "*") (Join-Path $stage "vendor\java-libs") -Recurse
}
if ($Jdk) {
  Write-Host "      JDK 푸는 중..."
  Expand-Archive -Path $jdkZip -DestinationPath (Join-Path $stage "jdk")
  if (-not (Get-ChildItem (Join-Path $stage "jdk") -Directory | Where-Object { Test-Path (Join-Path $_.FullName "bin\javac.exe") })) {
    Fail "푼 JDK 에서 bin\javac.exe 를 찾지 못했습니다."
  }
}

$extraLines = @()
if ($Ffmpeg)   { $extraLines += "  ffmpeg.exe               영상 변환용 (GPL-3.0, ffmpeg-LICENSE.txt 참고)" }
if ($Jdk)      { $extraLines += "  jdk/                     자바 실행·채점용 JDK ($jdkRelease)" }
if ($JavaLibs) { $extraLines += "  vendor/java-libs/        자바 라이브러리 jar" }
$missing = @()
if (-not $Ffmpeg) { $missing += "영상 변환(ffmpeg)" }
if (-not $Jdk)    { $missing += "자바(JDK)" }
$missingNote = ""
if ($missing.Count -gt 0) {
  $missingNote = "`r`n  - " + ($missing -join ", ") + " 는 들어 있지 않습니다. 인터넷이 되면 처음 쓸 때 앱이 버튼 한 번으로 받습니다."
}

$readme = @"
ClassDock $appVersion - 테스트용 패키지 ($(Get-Date -Format "yyyy-MM-dd") 빌드)
================================

■ 실행 방법
  1. 이 zip을 아무 폴더에나 "압축 풀기" 하세요.
     (exe만 따로 빼내면 안 됩니다 - 옆의 폴더들이 함께 있어야 인터넷 없이 동작합니다.)
  2. ClassDock.exe 를 더블클릭하세요.
  3. 잠시 후 기본 브라우저에 앱 화면이 열립니다.

■ 폴더 구성
  ClassDock.exe   실행 파일 (앱 전체가 내장됨)
  vendor/pyodide/          인터넷 없이 파이썬을 돌리기 위한 코어
  vendor/wheels/           추가 파이썬 패키지 오프라인 설치용
$($extraLines -join "`r`n")
  API-인증키-안내.md       버스·지하철 실시간, 카카오 검색·길찾기, 고시환율에 필요한 인증키 받는 법
  THIRD_PARTY_NOTICES.txt  앱에 들어 있는 오픈소스 라이브러리·글꼴·음원의 라이선스와 저작자 표시

■ 참고
  - 버스·지하철 실시간처럼 인터넷과 각자 받은 인증키가 필요한 기능은 예외입니다 (API-인증키-안내.md 참고).$missingNote
  - DB 접속(.dbconn) 등 일부 기능은 python.org 파이썬 설치가 필요합니다 (설치할 때 'Add python.exe to PATH' 체크).
  - 처음 실행 시 Windows 보안 경고가 뜨면 "추가 정보 -> 실행"을 눌러주세요.
  - 파일은 외부로 전송되지 않고 모든 처리는 내 PC 안에서만 이뤄집니다.
"@
Set-Content -Path (Join-Path $stage "먼저읽어주세요.txt") -Value $readme -Encoding UTF8

# [5/5] 압축 (dist\ClassDock-버전-YYYY-MM-DD[-전체].zip)
Write-Host "[5/5] 압축 중... (JDK·ffmpeg 를 담으면 몇 분 걸립니다)"
if (-not (Test-Path "dist")) { New-Item -ItemType Directory -Path "dist" | Out-Null }
$today = Get-Date -Format "yyyy-MM-dd"
$suffix = ""
if ($Ffmpeg -and $Jdk) { $suffix = "-전체" } elseif ($Ffmpeg -or $Jdk -or $JavaLibs) { $suffix = "-추가" }
$zip = "dist\ClassDock-$appVersion-$today$suffix.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -CompressionLevel Optimal

Remove-Item $stage -Recurse -Force

# 배포 기록(release.json) — 다음 pack 때 앱 내용이 바뀌었는지 이 기록과 비교한다. 같은 번호·같은 내용이면 늘리지 않는다.
$recorded = & node tools/release.js record $zip
if ($LASTEXITCODE -ne 0) { Write-Host ">> 배포 기록(release.json)을 남기지 못했습니다. 다음 pack 때 버전을 다시 묻게 됩니다." -ForegroundColor Yellow }
elseif ("$recorded".Trim() -eq "recorded") { Write-Host "      release.json 에 $appVersion 배포를 기록했습니다 (package.json·release.json 은 커밋해 두세요)." }

$info = Get-Item $zip
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host ("  완료!  >>  {0}  ({1:N1} MB)" -f $info.FullName, ($info.Length / 1MB)) -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host "이 zip 하나만 전달하면 됩니다."
Write-Host ""
Read-Host "종료하려면 Enter"
