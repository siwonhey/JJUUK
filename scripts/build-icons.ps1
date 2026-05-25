# assets/source-icon.png 을 받아 트레이/앱 아이콘 전체 세트를 생성한다.
# - PNG: 22/44 (Mac template), 32/64 (general), 1024 (app icon)
# - ICO: 16/24/32/48/64/128/256 멀티 해상도 (Windows 트레이/설치)
#
# 사용: powershell -ExecutionPolicy Bypass -File scripts/build-icons.ps1
Add-Type -AssemblyName System.Drawing

$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$src  = Join-Path $root "assets\source-icon.png"
$tray = Join-Path $root "assets\tray"
$app  = Join-Path $root "assets\app-icon.png"

if (-not (Test-Path $src)) {
    Write-Error "Source not found: $src"
    exit 1
}
if (-not (Test-Path $tray)) {
    New-Item -ItemType Directory -Force -Path $tray | Out-Null
}

# Source 를 한번만 디스크에서 읽어 메모리 비트맵으로 유지 (파일 잠금 회피)
$srcBytes = [System.IO.File]::ReadAllBytes($src)
$srcMs    = New-Object System.IO.MemoryStream(,$srcBytes)
$srcImg   = [System.Drawing.Image]::FromStream($srcMs)

function New-Resized {
    param([int]$size)
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    # contain-fit: 정사각 캔버스의 가장 긴 변에 맞춰 동일 비율 확대/축소
    $srcW = $srcImg.Width
    $srcH = $srcImg.Height
    $scale = [Math]::Min($size / $srcW, $size / $srcH)
    $w = [int]($srcW * $scale)
    $h = [int]($srcH * $scale)
    $x = [int](($size - $w) / 2)
    $y = [int](($size - $h) / 2)
    $g.DrawImage($srcImg, $x, $y, $w, $h)
    $g.Dispose()
    return $bmp
}

function Save-Png {
    param([System.Drawing.Bitmap]$bmp, [string]$path)
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function Save-Ico {
    param([System.Drawing.Bitmap[]]$bitmaps, [string]$path)
    $pngBytes = @()
    foreach ($b in $bitmaps) {
        $ms = New-Object System.IO.MemoryStream
        $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $pngBytes += ,$ms.ToArray()
        $ms.Dispose()
    }
    $count = $bitmaps.Count
    $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Create)
    $bw = New-Object System.IO.BinaryWriter($fs)
    # ICONDIR
    $bw.Write([uint16]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]$count)
    $offset = 6 + ($count * 16)
    for ($i = 0; $i -lt $count; $i++) {
        $b = $bitmaps[$i]
        $size = $b.Width
        # ICO 의 width/height 는 1 byte — 256 은 0 으로 표기
        $w = if ($size -ge 256) { 0 } else { $size }
        $bw.Write([byte]$w)
        $bw.Write([byte]$w)
        $bw.Write([byte]0)
        $bw.Write([byte]0)
        $bw.Write([uint16]1)
        $bw.Write([uint16]32)
        $bw.Write([uint32]$pngBytes[$i].Length)
        $bw.Write([uint32]$offset)
        $offset += $pngBytes[$i].Length
    }
    foreach ($pb in $pngBytes) { $bw.Write($pb) }
    $bw.Dispose()
    $fs.Dispose()
}

# Mac template (1x = 22, 2x = 44) + general PNG (32, 64) + app icon (1024)
$bmp22   = New-Resized -size 22
$bmp44   = New-Resized -size 44
$bmp32   = New-Resized -size 32
$bmp64   = New-Resized -size 64
$bmp1024 = New-Resized -size 1024

Save-Png $bmp22   (Join-Path $tray "iconTemplate.png")
Save-Png $bmp44   (Join-Path $tray "iconTemplate@2x.png")
Save-Png $bmp32   (Join-Path $tray "icon.png")
Save-Png $bmp64   (Join-Path $tray "icon@2x.png")
Save-Png $bmp1024 $app

# Windows multi-resolution ICO
$icoSizes = 16, 24, 32, 48, 64, 128, 256
$icoBmps = @()
foreach ($s in $icoSizes) { $icoBmps += (New-Resized -size $s) }
Save-Ico -bitmaps $icoBmps -path (Join-Path $tray "icon.ico")

# cleanup
$bmp22.Dispose(); $bmp44.Dispose(); $bmp32.Dispose(); $bmp64.Dispose(); $bmp1024.Dispose()
foreach ($b in $icoBmps) { $b.Dispose() }
$srcImg.Dispose(); $srcMs.Dispose()

Write-Output "Generated tray icons:"
Get-ChildItem $tray | Format-Table Name, Length -AutoSize
Write-Output "Generated app icon:"
Get-Item $app | Format-Table Name, Length -AutoSize
