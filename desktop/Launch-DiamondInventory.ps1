param([switch]$OpenApp)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'

function Wait-Healthy([string]$Url, [int]$Seconds = 45) {
  $until = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $until) {
    try { if ((Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 $Url).StatusCode -eq 200) { return $true } } catch {}
    Start-Sleep -Seconds 1
  }
  return $false
}
function Start-AppProcess([string]$Folder, [string]$Command) {
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $Command -WorkingDirectory $Folder -WindowStyle Hidden
}

if (-not (Wait-Healthy 'http://127.0.0.1:4000/health' 2)) { Start-AppProcess $backend 'npm.cmd start' }
if (-not (Wait-Healthy 'http://127.0.0.1:4000/ready')) { throw 'Backend did not become ready. Check backend/.env and the database connection.' }
if (-not (Test-Path (Join-Path $frontend '.next\BUILD_ID'))) { Push-Location $frontend; try { npm.cmd run build } finally { Pop-Location } }
if (-not (Wait-Healthy 'http://127.0.0.1:3000/login' 2)) { Start-AppProcess $frontend 'npm.cmd start' }
if (-not (Wait-Healthy 'http://127.0.0.1:3000/login')) { throw 'Frontend did not become ready. Run npm run build in frontend and try again.' }
if ($OpenApp) {
  $edge = @("$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($edge) { Start-Process $edge '--app=http://localhost:3000' } else { Start-Process 'http://localhost:3000' }
}
Write-Host 'Diamond Inventory is running.'
