param(
    [string]$SourceDir = 'C:\Users\zeel1\Downloads\Jewelry Status assets',
    [string]$OutputDir = 'C:\Users\zeel1\diamond-inventory\output\jewelry-status'
)

$ErrorActionPreference = 'Stop'
$ffmpeg = 'C:\Users\zeel1\diamond-inventory\tools\ffmpeg\ffmpeg-8.1.2-essentials_build\bin\ffmpeg.exe'
$python = 'C:\Users\zeel1\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$audioScript = 'C:\Users\zeel1\diamond-inventory\scripts\create_luxury_audio.py'
$segmentDir = Join-Path $OutputDir 'segments'
New-Item -ItemType Directory -Force -Path $OutputDir, $segmentDir | Out-Null

$transition = 0.35
$items = @(
    @{ Type='video'; File='IMG_5662.MOV'; Start=0.30; Duration=5.20 },
    @{ Type='photo'; File='IMG_5661.JPG.jpeg'; Duration=2.70; Motion='in' },
    @{ Type='photo'; File='IMG_5664.JPG.jpeg'; Duration=2.70; Motion='out' },
    @{ Type='video'; File='IMG_5652.MOV'; Start=0.25; Duration=3.70 },
    @{ Type='photo'; File='IMG_5666.JPG.jpeg'; Duration=2.70; Motion='in' },
    @{ Type='video'; File='IMG_5655.MOV'; Start=0.25; Duration=4.70 },
    @{ Type='photo'; File='IMG_5653.JPG.jpeg'; Duration=2.70; Motion='out' },
    @{ Type='video'; File='IMG_5658.MOV'; Start=0.20; Duration=3.30 },
    @{ Type='photo'; File='IMG_5656.JPG.jpeg'; Duration=2.70; Motion='in' }
)

$color = 'eq=contrast=1.035:saturation=1.055:brightness=0.004:gamma=1.01,colorbalance=rs=.012:gs=.004:bs=-.008'
$segmentPaths = @()

for ($index = 0; $index -lt $items.Count; $index++) {
    $item = $items[$index]
    $source = Join-Path $SourceDir $item.File
    $segment = Join-Path $segmentDir ('segment-{0:D2}.mp4' -f ($index + 1))
    $segmentPaths += $segment

    if ($item.Type -eq 'video') {
        $vf = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,$color,setsar=1,fps=30,format=yuv420p"
        & $ffmpeg -hide_banner -loglevel error -ss $item.Start -i $source -t $item.Duration -an -vf $vf `
            -c:v libx264 -preset faster -crf 17 -pix_fmt yuv420p -r 30 -y $segment
    }
    else {
        $frames = [int][Math]::Round($item.Duration * 30)
        if ($item.Motion -eq 'out') {
            $zoom = "if(eq(on,1),1.045,max(1.0,zoom-0.00055))"
        }
        else {
            $zoom = "min(1.0+on*0.00055,1.045)"
        }
        $vf = "scale=2160:3840:force_original_aspect_ratio=increase,crop=2160:3840,zoompan=z='$zoom':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30,$color,setsar=1,format=yuv420p"
        & $ffmpeg -hide_banner -loglevel error -loop 1 -i $source -frames:v $frames -an -vf $vf `
            -c:v libx264 -preset faster -crf 17 -pix_fmt yuv420p -r 30 -y $segment
    }
    if ($LASTEXITCODE -ne 0) {
        throw "FFmpeg segment render failed for $($item.File) with exit code $LASTEXITCODE"
    }
}

$duration = ($items | ForEach-Object { [double]$_['Duration'] } | Measure-Object -Sum).Sum - (($items.Count - 1) * $transition)
$audio = Join-Path $OutputDir 'luxury-bed.wav'
& $python $audioScript --duration $duration --output $audio

$inputArgs = @()
foreach ($segment in $segmentPaths) {
    $inputArgs += @('-i', $segment)
}
$inputArgs += @('-i', $audio)

$filterParts = @()
$offset = [double]$items[0].Duration - $transition
$previousLabel = '0:v'
for ($index = 1; $index -lt $items.Count; $index++) {
    $outputLabel = "v$index"
    $filterParts += "[$previousLabel][$index`:v]xfade=transition=fade:duration=$transition`:offset=$($offset.ToString('0.000',[Globalization.CultureInfo]::InvariantCulture))[$outputLabel]"
    $previousLabel = $outputLabel
    $offset += [double]$items[$index].Duration - $transition
}
$fadeStart = $duration - 0.50
$filterParts += "[$previousLabel]fade=t=in:st=0:d=0.45,fade=t=out:st=$($fadeStart.ToString('0.000',[Globalization.CultureInfo]::InvariantCulture)):d=0.50[vfinal]"
$filter = $filterParts -join ';'

$final = Join-Path $OutputDir 'jewelry-whatsapp-status.mp4'
$audioIndex = $items.Count
$renderArgs = $inputArgs + @(
    '-filter_complex', $filter,
    '-map', '[vfinal]',
    '-map', "$audioIndex`:a:0",
    '-t', $duration.ToString('0.000',[Globalization.CultureInfo]::InvariantCulture),
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '19',
    '-pix_fmt', 'yuv420p',
    '-r', '30',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '48000',
    '-ac', '2',
    '-movflags', '+faststart',
    '-y', $final
)

& $ffmpeg @renderArgs
if ($LASTEXITCODE -ne 0) {
    throw "FFmpeg final render failed with exit code $LASTEXITCODE"
}

Write-Output $final
