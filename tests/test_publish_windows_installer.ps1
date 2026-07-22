$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$publisher = Join-Path $repoRoot 'scripts\publish-windows-installer.ps1'
$sourceInstaller = Join-Path $env:TEMP 'DiamondInventory-publish-test.exe'
$outputRoot = Join-Path $env:TEMP 'DiamondInventory-publish-test-output'
$defaultRoot = Join-Path $env:TEMP 'DiamondInventory-publish-default-root'

try {
    [System.IO.File]::WriteAllBytes($sourceInstaller, [byte[]](1, 3, 3, 7))
    if (Test-Path -LiteralPath $outputRoot) {
        Remove-Item -LiteralPath $outputRoot -Recurse -Force
    }

    & $publisher -InstallerPath $sourceInstaller -Version '9.8.7' -OutputRoot $outputRoot

    $published = Join-Path $outputRoot 'frontend\public\downloads\DiamondInventory-Setup-9.8.7.exe'
    $metadataPath = Join-Path $outputRoot 'frontend\src\release.json'
    if (-not (Test-Path -LiteralPath $published)) { throw 'Versioned installer was not published.' }
    if (-not (Test-Path -LiteralPath $metadataPath)) { throw 'Release metadata was not published.' }

    $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
    $expectedHash = (Get-FileHash -LiteralPath $sourceInstaller -Algorithm SHA256).Hash
    if ($metadata.version -ne '9.8.7') { throw 'Release version does not match.' }
    if ($metadata.fileName -ne 'DiamondInventory-Setup-9.8.7.exe') { throw 'Release filename does not match.' }
    if ($metadata.sizeBytes -ne 4) { throw 'Release size does not match.' }
    if ($metadata.sha256 -ne $expectedHash) { throw 'Release checksum does not match.' }
    if ($metadata.downloadUrl -ne '/downloads/DiamondInventory-Setup-9.8.7.exe') { throw 'Release URL does not match.' }

    $copiedScripts = Join-Path $defaultRoot 'scripts'
    New-Item -ItemType Directory -Path $copiedScripts -Force | Out-Null
    $copiedPublisher = Join-Path $copiedScripts 'publish-windows-installer.ps1'
    Copy-Item -LiteralPath $publisher -Destination $copiedPublisher
    & powershell -NoProfile -ExecutionPolicy Bypass -File $copiedPublisher -InstallerPath $sourceInstaller -Version '1.2.3'
    if ($LASTEXITCODE -ne 0) { throw 'Publisher failed when launched as a PowerShell file.' }
    $defaultPublished = Join-Path $defaultRoot 'frontend\public\downloads\DiamondInventory-Setup-1.2.3.exe'
    if (-not (Test-Path -LiteralPath $defaultPublished)) { throw 'Default output root was not resolved from the script location.' }

    Write-Output 'PASS: versioned installer and verified release metadata are published.'
}
finally {
    Remove-Item -LiteralPath $sourceInstaller -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $outputRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $defaultRoot -Recurse -Force -ErrorAction SilentlyContinue
}
