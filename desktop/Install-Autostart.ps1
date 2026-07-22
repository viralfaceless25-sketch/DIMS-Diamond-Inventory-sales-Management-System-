$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'Launch-DiamondInventory.ps1'
$startup = [Environment]::GetFolderPath('Startup')
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path $startup 'Diamond Inventory Server.lnk'))
$shortcut.TargetPath = 'powershell.exe'
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$launcher`""
$shortcut.WorkingDirectory = $root
$shortcut.Save()
Write-Host "Automatic startup installed for this Windows user."
