param(
    [Parameter(Mandatory = $true)]
    [string]$InstallerPath,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,

    [string]$OutputRoot
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Split-Path -Parent $PSScriptRoot
}
$resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath).Path
$resolvedOutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)
$fileName = "DiamondInventory-Setup-$Version.exe"
$downloadDirectory = Join-Path $resolvedOutputRoot 'frontend\public\downloads'
$metadataDirectory = Join-Path $resolvedOutputRoot 'frontend\src'
$publishedInstaller = Join-Path $downloadDirectory $fileName
$metadataPath = Join-Path $metadataDirectory 'release.json'

New-Item -ItemType Directory -Path $downloadDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $metadataDirectory -Force | Out-Null
Copy-Item -LiteralPath $resolvedInstaller -Destination $publishedInstaller -Force

$publishedFile = Get-Item -LiteralPath $publishedInstaller
$checksum = (Get-FileHash -LiteralPath $publishedInstaller -Algorithm SHA256).Hash
$metadata = [ordered]@{
    version = $Version
    fileName = $fileName
    sizeBytes = $publishedFile.Length
    sha256 = $checksum
    downloadUrl = "/downloads/$fileName"
}

$metadata | ConvertTo-Json | Set-Content -LiteralPath $metadataPath -Encoding utf8
Write-Output "Published $fileName ($($publishedFile.Length) bytes, SHA-256 $checksum)"
