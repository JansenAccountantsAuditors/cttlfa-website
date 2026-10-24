# Renders protest-complaint-guide-2026.html to docs/ as PDF, full-size JPG and web JPG (Edge headless).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$src  = Join-Path $PSScriptRoot 'protest-complaint-guide-2026.html'
$url  = 'file:///' + ($src -replace '\\','/')
$docs = Join-Path $root 'docs'
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe","$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$tmp  = Join-Path $env:TEMP 'cttlfa-guide'
New-Item -ItemType Directory -Force $tmp | Out-Null
$png = Join-Path $tmp 'guide.png'
$pdf = Join-Path $docs 'cttlfa-protest-complaint-guide-2026.pdf'
& $edge --headless=new --disable-gpu --hide-scrollbars --user-data-dir="$tmp\prof" --virtual-time-budget=8000 --force-device-scale-factor=2 --window-size=1200,2095 --screenshot="$png" $url | Out-Null
& $edge --headless=new --disable-gpu --user-data-dir="$tmp\prof" --virtual-time-budget=8000 --no-pdf-header-footer --print-to-pdf="$pdf" $url | Out-Null
Start-Sleep -Seconds 2
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($png)
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
function Save-Jpg($bmp, $path, $q) { $p = New-Object System.Drawing.Imaging.EncoderParameters 1; $p.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]$q); $bmp.Save($path, $codec, $p) }
Save-Jpg $img (Join-Path $docs 'cttlfa-protest-complaint-guide-2026.jpg') 86
$w = 1400; $h = [int]($img.Height * $w / $img.Width)
$small = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($small); $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($img, 0, 0, $w, $h); $g.Dispose()
Save-Jpg $small (Join-Path $docs 'cttlfa-protest-complaint-guide-2026-web.jpg') 82
"png {0}x{1}" -f $img.Width, $img.Height
$small.Dispose(); $img.Dispose()
Get-ChildItem $docs -Filter 'cttlfa-protest-complaint-guide-2026*' | ForEach-Object { $_.Name + '  ' + $_.Length }
