# Removes the Jungle Leopard LCD Bridge: stops it, deletes the autostart entry and its folder.
#   powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\JungleLeopardBridge\uninstall.ps1"

$ErrorActionPreference = 'SilentlyContinue'

Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
    Where-Object { $_.CommandLine -like '*JungleLeopardBridge.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Remove-Item -Force (Join-Path ([Environment]::GetFolderPath('Startup')) 'Jungle Leopard LCD Bridge.lnk')
Start-Sleep -Milliseconds 500
Remove-Item -Recurse -Force (Join-Path $env:LOCALAPPDATA 'JungleLeopardBridge')

Write-Host 'Jungle Leopard LCD Bridge wurde entfernt.'
