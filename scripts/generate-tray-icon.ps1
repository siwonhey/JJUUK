# 모노톤 거북이 트레이 아이콘 생성
# - PNG (16/32) for macOS template + general use
# - ICO (16+32 multi-size embedded) for Windows tray
Add-Type -AssemblyName System.Drawing

function Draw-Turtle {
    param([System.Drawing.Graphics]$g, [int]$size)
    $s = $size / 32.0
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Black)

    # 등껍질 (캔버스 70% 차지하는 큰 원)
    $g.FillEllipse($brush, 3 * $s, 7 * $s, 22 * $s, 20 * $s)

    # 머리 (오른쪽으로 또렷하게 돌출)
    $g.FillEllipse($brush, 21 * $s, 10 * $s, 10 * $s, 11 * $s)

    # 다리는 32px 이상에서만 (16px 에선 점 수준이 되어 오히려 노이즈)
    if ($size -ge 24) {
        $g.FillEllipse($brush, 1 * $s,  10 * $s, 5 * $s, 4 * $s)
        $g.FillEllipse($brush, 1 * $s,  20 * $s, 5 * $s, 4 * $s)
        $g.FillEllipse($brush, 18 * $s, 24 * $s, 6 * $s, 4 * $s)
        $g.FillEllipse($brush, 8 * $s,  25 * $s, 6 * $s, 4 * $s)
    }
    $brush.Dispose()
}

function New-TurtleBitmap {
    param([int]$size)
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    # 16px 는 antialias 끄면 픽셀이 또렷
    if ($size -le 16) {
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
    } else {
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    }
    $g.Clear([System.Drawing.Color]::Transparent)
    Draw-Turtle -g $g -size $size
    $g.Dispose()
    return $bmp
}

function Save-Png {
    param([System.Drawing.Bitmap]$bmp, [string]$path)
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

# PNG 들을 묶어 ICO 컨테이너로 직렬화 (PNG-in-ICO 형식: 16x16, 32x32 동시 수록)
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

    # ICONDIR (6 bytes): reserved(0), type(1=icon), count
    $bw.Write([uint16]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]$count)

    $offset = 6 + ($count * 16)
    for ($i = 0; $i -lt $count; $i++) {
        $b = $bitmaps[$i]
        $size = $b.Width
        $bw.Write([byte]($size -band 0xFF))   # width  (0 = 256)
        $bw.Write([byte]($size -band 0xFF))   # height
        $bw.Write([byte]0)                    # palette color count
        $bw.Write([byte]0)                    # reserved
        $bw.Write([uint16]1)                  # color planes
        $bw.Write([uint16]32)                 # bits/pixel
        $bw.Write([uint32]$pngBytes[$i].Length)  # image size
        $bw.Write([uint32]$offset)            # offset
        $offset += $pngBytes[$i].Length
    }

    foreach ($pb in $pngBytes) { $bw.Write($pb) }

    $bw.Dispose()
    $fs.Dispose()
}

$dir = Join-Path $PSScriptRoot "..\assets\tray"
$dir = [System.IO.Path]::GetFullPath($dir)
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

# PNG 생성
$bmp16 = New-TurtleBitmap -size 16
$bmp32 = New-TurtleBitmap -size 32

Save-Png $bmp16 (Join-Path $dir "icon.png")
Save-Png $bmp32 (Join-Path $dir "icon@2x.png")
Save-Png $bmp16 (Join-Path $dir "iconTemplate.png")
Save-Png $bmp32 (Join-Path $dir "iconTemplate@2x.png")

# 멀티 사이즈 ICO 생성 (Windows 트레이용)
Save-Ico -bitmaps @($bmp16, $bmp32) -path (Join-Path $dir "icon.ico")

$bmp16.Dispose()
$bmp32.Dispose()

Write-Output "Generated:"
Get-ChildItem $dir | Format-Table Name, Length -AutoSize
