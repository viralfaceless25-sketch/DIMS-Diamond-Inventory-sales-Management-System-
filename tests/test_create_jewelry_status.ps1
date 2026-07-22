$ErrorActionPreference = 'Stop'
$scriptPath = 'C:\Users\zeel1\diamond-inventory\scripts\create_jewelry_status.ps1'
$scriptText = Get-Content -Raw -LiteralPath $scriptPath
$failures = @()

if (-not $scriptText.Contains('d=${frames}:s=1080x1920')) {
    $failures += 'zoompan frame count must use a braced PowerShell variable before the colon'
}
if (-not $scriptText.Contains("ForEach-Object { [double]`$_['Duration'] }")) {
    $failures += 'duration sum must read values from each hashtable explicitly'
}
if (-not $scriptText.Contains('FFmpeg segment render failed')) {
    $failures += 'each segment render must fail fast when FFmpeg returns a non-zero exit code'
}

if ($failures.Count -gt 0) {
    throw ($failures -join '; ')
}

Write-Output 'Render script regression checks passed.'
