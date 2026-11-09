# Removes the Jungle Leopard LCD Bridge of plugin 1.1.0: stops it, deletes the autostart entry and its folder.
# Plugin 2.0.0 talks to the display through SignalRGB's own serial module and no longer needs the bridge.
#   irm https://raw.githubusercontent.com/lencraft151-cloud/Jungle-Leopard-360-Watercool-addon-for-SignalRGB-/HEAD/bridge/uninstall.ps1 | iex

$ErrorActionPreference = 'SilentlyContinue'

Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
    Where-Object { $_.CommandLine -like '*JungleLeopardBridge.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Remove-Item -Force (Join-Path ([Environment]::GetFolderPath('Startup')) 'Jungle Leopard LCD Bridge.lnk')
Start-Sleep -Milliseconds 500
Remove-Item -Recurse -Force (Join-Path $env:LOCALAPPDATA 'JungleLeopardBridge')

Write-Host 'Jungle Leopard LCD Bridge wurde entfernt.'
