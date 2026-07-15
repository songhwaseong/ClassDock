# clean-sprite.ps1 - photo-converted pixel sprite sheet cleanup (white fringe removal)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File tools\clean-sprite.ps1 -Path src\assets\my-char.png [-CellW 96] [-Backup]
#
# Removes the pale halo that photo-to-pixel conversion leaves around a character,
# without touching intended art (climbing pole, walls, ground shadows, glasses glint).
# Overwrites -Path in place; -Backup first copies to <name>.bak.png.
# After running: node build-offline.js + desktop\build.bat to rebuild the exe.
#
# Passes (in order):
#   1. Semi-transparent pixels: edge ones (touching transparency) become fully
#      transparent; interior ones are baked onto the average of their opaque
#      neighbors at their original alpha (faint white specks dissolve, strong
#      highlights like glasses glint survive).
#   2. Opaque gray fringe on the outline: low-saturation pixels (lum 90-215)
#      touching transparency are removed, EXCEPT connected clusters of 20+ px
#      (pole/wall/long shadows) and anything in the bottom shadow band.
#   3. Despeckle: bright low-sat clusters (<=5 px) fully surrounded by dark
#      opaque pixels (hair-gap specks) are blended into the surrounding color.
#   4. Floating gray above the head: per column, a short (<=4 px) light-gray
#      prefix of the first opaque run is erased when what follows is dark or
#      nothing. Walls/pole stay light for many rows, so they never match.
#
# NOTE: keep this file ASCII-only. PowerShell 5.1 reads BOM-less files as ANSI
# and UTF-8 Korean comments corrupt the parser in subtle ways.

param(
  [Parameter(Mandatory=$true)][string]$Path,
  [int]$CellW = 96,
  [switch]$Backup
)

Add-Type -AssemblyName System.Drawing
$Path = (Resolve-Path $Path).Path
if($Backup){
  $bak = [System.IO.Path]::ChangeExtension($Path, ".bak.png")
  Copy-Item $Path $bak -Force
  Write-Host "backup: $bak"
}

$fbytes = [System.IO.File]::ReadAllBytes($Path)
$ms = New-Object System.IO.MemoryStream(,$fbytes)
$img = [System.Drawing.Image]::FromStream($ms)
$bmp = New-Object System.Drawing.Bitmap $img
$img.Dispose()
$w = $bmp.Width; $h = $bmp.Height
$rect = New-Object System.Drawing.Rectangle 0,0,$w,$h
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$stride = $data.Stride
$bytes = New-Object byte[] ($stride * $h)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
$orig = New-Object byte[] $bytes.Length
[Array]::Copy($bytes, $orig, $bytes.Length)

# geometry-derived bands (tuned on a 96x120 sheet, scale with cell height)
$shadowBandY = [int][math]::Floor($h * 98 / 120)   # bottom band: ground shadows live here
$topSearchY  = [int][math]::Floor($h / 2)          # head zone for passes 3-4

function AlphaAt($x,$y){ if($x -lt 0 -or $y -lt 0 -or $x -ge $script:w -or $y -ge $script:h){return 0}; return $script:orig[$y*$script:stride+$x*4+3] }
function Lum($r,$g,$b){ return 0.299*$r + 0.587*$g + 0.114*$b }

# ---- pass 1: semi-transparent pixels --------------------------------------
$removedSemi=0; $baked=0
for($y=0; $y -lt $h; $y++){
  for($x=0; $x -lt $w; $x++){
    $i = $y*$stride + $x*4
    $a = $orig[$i+3]
    if($a -eq 0 -or $a -eq 255){ continue }
    $onEdge = ((AlphaAt ($x-1) $y) -eq 0 -or (AlphaAt ($x+1) $y) -eq 0 -or (AlphaAt $x ($y-1)) -eq 0 -or (AlphaAt $x ($y+1)) -eq 0)
    if($onEdge){
      $bytes[$i]=0; $bytes[$i+1]=0; $bytes[$i+2]=0; $bytes[$i+3]=0; $removedSemi++
    } else {
      $nr=0; $ng=0; $nb=0; $nn=0
      for($dy=-1; $dy -le 1; $dy++){ for($dx=-1; $dx -le 1; $dx++){
        if($dx -eq 0 -and $dy -eq 0){ continue }
        $nx=$x+$dx; $ny=$y+$dy
        if($nx -lt 0 -or $ny -lt 0 -or $nx -ge $w -or $ny -ge $h){ continue }
        $nj=$ny*$stride+$nx*4
        if($orig[$nj+3] -eq 255){ $nb+=$orig[$nj]; $ng+=$orig[$nj+1]; $nr+=$orig[$nj+2]; $nn++ }
      } }
      if($nn -gt 0){
        $af = $a / 255.0
        $bytes[$i]   = [byte][math]::Round($orig[$i]  *$af + ($nb/$nn)*(1-$af))
        $bytes[$i+1] = [byte][math]::Round($orig[$i+1]*$af + ($ng/$nn)*(1-$af))
        $bytes[$i+2] = [byte][math]::Round($orig[$i+2]*$af + ($nr/$nn)*(1-$af))
      }
      $bytes[$i+3]=255; $baked++
    }
  }
}

# ---- pass 2: opaque gray fringe on the outline ----------------------------
$cand = New-Object 'bool[]' ($w*$h)
for($y=0; $y -lt $h; $y++){
  for($x=0; $x -lt $w; $x++){
    $i = $y*$stride + $x*4
    if($orig[$i+3] -ne 255){ continue }
    $onEdge = ((AlphaAt ($x-1) $y) -eq 0 -or (AlphaAt ($x+1) $y) -eq 0 -or (AlphaAt $x ($y-1)) -eq 0 -or (AlphaAt $x ($y+1)) -eq 0)
    if(-not $onEdge){ continue }
    $b=$orig[$i]; $g=$orig[$i+1]; $r=$orig[$i+2]
    $mx=[math]::Max($r,[math]::Max($g,$b)); $mn=[math]::Min($r,[math]::Min($g,$b))
    $lum = Lum $r $g $b
    if(($mx-$mn) -lt 34 -and $lum -ge 90 -and $lum -le 215){ $cand[$y*$w+$x] = $true }
  }
}
$visited = New-Object 'bool[]' ($w*$h)
$removedGray=0; $minKeep=20
for($y=0; $y -lt $h; $y++){
  for($x=0; $x -lt $w; $x++){
    $idx = $y*$w+$x
    if(-not $cand[$idx] -or $visited[$idx]){ continue }
    $stack = New-Object System.Collections.Generic.Stack[int]
    $stack.Push($idx); $visited[$idx]=$true
    $comp = New-Object System.Collections.Generic.List[int]
    while($stack.Count -gt 0){
      $c = $stack.Pop(); $comp.Add($c)
      $cy = [math]::Floor($c/$w); $cx = $c - $cy*$w
      for($dy=-1; $dy -le 1; $dy++){ for($dx=-1; $dx -le 1; $dx++){
        if($dx -eq 0 -and $dy -eq 0){ continue }
        $nx=$cx+$dx; $ny=$cy+$dy
        if($nx -lt 0 -or $ny -lt 0 -or $nx -ge $w -or $ny -ge $h){ continue }
        $ni=$ny*$w+$nx
        if($cand[$ni] -and -not $visited[$ni]){ $visited[$ni]=$true; $stack.Push($ni) }
      } }
    }
    $minY = 999999
    foreach($c in $comp){ $cy2 = [math]::Floor($c/$w); if($cy2 -lt $minY){ $minY = $cy2 } }
    if($comp.Count -lt $minKeep -and $minY -lt $shadowBandY){
      foreach($c in $comp){
        $cy = [math]::Floor($c/$w); $cx = $c - $cy*$w
        $bi = $cy*$stride + $cx*4
        $bytes[$bi]=0; $bytes[$bi+1]=0; $bytes[$bi+2]=0; $bytes[$bi+3]=0
        $removedGray++
      }
    }
  }
}

# ---- pass 3: despeckle bright clusters inside dark areas ------------------
# (works on the pass-1/2 result, so refresh the reference copy)
[Array]::Copy($bytes, $orig, $bytes.Length)
$mask = New-Object 'bool[]' ($w*$h)
for($y=0; $y -lt $topSearchY*2 -and $y -lt $h; $y++){
  for($x=0; $x -lt $w; $x++){
    $i = $y*$stride + $x*4
    if($orig[$i+3] -ne 255){ continue }
    $b0=$orig[$i]; $g0=$orig[$i+1]; $r0=$orig[$i+2]
    $mx=[math]::Max($r0,[math]::Max($g0,$b0)); $mn=[math]::Min($r0,[math]::Min($g0,$b0))
    if(($mx-$mn) -ge 40){ continue }
    if((Lum $r0 $g0 $b0) -gt 120){ $mask[$y*$w+$x] = $true }
  }
}
$visited2 = New-Object 'bool[]' ($w*$h)
$despeckled = 0
for($y=0; $y -lt $h; $y++){
  for($x=0; $x -lt $w; $x++){
    $idx = $y*$w+$x
    if(-not $mask[$idx] -or $visited2[$idx]){ continue }
    $stack = New-Object System.Collections.Generic.Stack[int]
    $stack.Push($idx); $visited2[$idx]=$true
    $comp = New-Object System.Collections.Generic.List[int]
    $tooBig = $false
    while($stack.Count -gt 0){
      $c = $stack.Pop(); $comp.Add($c)
      if($comp.Count -gt 5){ $tooBig = $true }
      $cy=[math]::Floor($c/$w); $cx=$c-($cy*$w)
      for($dy=-1;$dy -le 1;$dy++){ for($dx=-1;$dx -le 1;$dx++){
        if($dx -eq 0 -and $dy -eq 0){continue}
        $nx=$cx+$dx; $ny=$cy+$dy
        if($nx -lt 0 -or $ny -lt 0 -or $nx -ge $w -or $ny -ge $h){continue}
        $ni=$ny*$w+$nx
        if($mask[$ni] -and -not $visited2[$ni]){ $visited2[$ni]=$true; $stack.Push($ni) }
      } }
    }
    if($tooBig){ continue }
    $ring = New-Object System.Collections.Generic.HashSet[int]
    $ok = $true
    foreach($c in $comp){
      $cy=[math]::Floor($c/$w); $cx=$c-($cy*$w)
      for($dy=-1;$dy -le 1;$dy++){ for($dx=-1;$dx -le 1;$dx++){
        if($dx -eq 0 -and $dy -eq 0){continue}
        $nx=$cx+$dx; $ny=$cy+$dy
        if($nx -lt 0 -or $ny -lt 0 -or $nx -ge $w -or $ny -ge $h){ $ok=$false; continue }
        $ni=$ny*$w+$nx
        if($comp.Contains($ni)){ continue }
        if($orig[$ny*$stride+$nx*4+3] -ne 255){ $ok=$false } else { [void]$ring.Add($ni) }
      } }
    }
    if(-not $ok -or $ring.Count -eq 0){ continue }
    $sr=0;$sg=0;$sb=0;$sl=0
    foreach($rp in $ring){
      $ry=[math]::Floor($rp/$w); $rx=$rp-($ry*$w)
      $rj=$ry*$stride+$rx*4
      $sb+=$orig[$rj]; $sg+=$orig[$rj+1]; $sr+=$orig[$rj+2]
      $sl += Lum $orig[$rj+2] $orig[$rj+1] $orig[$rj]
    }
    if(($sl/$ring.Count) -ge 100){ continue }
    $ar=[byte][math]::Round($sr/$ring.Count); $ag=[byte][math]::Round($sg/$ring.Count); $ab=[byte][math]::Round($sb/$ring.Count)
    foreach($c in $comp){
      $cy=[math]::Floor($c/$w); $cx=$c-($cy*$w)
      $bi=$cy*$stride+$cx*4
      $bytes[$bi]=$ab; $bytes[$bi+1]=$ag; $bytes[$bi+2]=$ar
      $despeckled++
    }
  }
}

# ---- pass 4: floating light-gray runs above the head ----------------------
[Array]::Copy($bytes, $orig, $bytes.Length)
$removedTop = 0
for($x=0; $x -lt $w; $x++){
  $y = 0
  while($y -lt $topSearchY -and $orig[$y*$stride+$x*4+3] -eq 0){ $y++ }
  if($y -ge $topSearchY){ continue }
  $prefStart = $y; $prefLen = 0
  while($y -lt $topSearchY -and $prefLen -le 4){
    $i = $y*$stride+$x*4
    if($orig[$i+3] -eq 0){ break }
    $b0=$orig[$i]; $g0=$orig[$i+1]; $r0=$orig[$i+2]
    $mx=[math]::Max($r0,[math]::Max($g0,$b0)); $mn=[math]::Min($r0,[math]::Min($g0,$b0))
    if(($mx-$mn) -lt 40 -and (Lum $r0 $g0 $b0) -gt 105){ $prefLen++; $y++ } else { break }
  }
  if($prefLen -lt 1 -or $prefLen -gt 4){ continue }
  if($y -lt $topSearchY){
    $i = $y*$stride+$x*4
    if($orig[$i+3] -ne 0){
      if((Lum $orig[$i+2] $orig[$i+1] $orig[$i]) -ge 90){ continue }
    }
  }
  for($ry=$prefStart; $ry -lt ($prefStart+$prefLen); $ry++){
    $i = $ry*$stride+$x*4
    $bytes[$i]=0; $bytes[$i+1]=0; $bytes[$i+2]=0; $bytes[$i+3]=0
    $removedTop++
  }
}

Write-Host "pass1 semi: removed=$removedSemi baked=$baked"
Write-Host "pass2 gray fringe removed: $removedGray"
Write-Host "pass3 despeckled: $despeckled"
Write-Host "pass4 head-top removed: $removedTop"

[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
$bmp.UnlockBits($data)
$tmp = "$Path.tmp.png"
$bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose(); $ms.Dispose()
Move-Item $tmp $Path -Force
Write-Host "saved: $Path"
