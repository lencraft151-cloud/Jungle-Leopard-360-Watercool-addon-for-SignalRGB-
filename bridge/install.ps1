# Installs the Jungle Leopard LCD Bridge for the current user. No administrator rights needed.
#
# From the internet (PowerShell):
#   irm https://raw.githubusercontent.com/lencraft151-cloud/Jungle-Leopard-360-Watercool-addon-for-SignalRGB-/HEAD/bridge/install.ps1 | iex
# From a downloaded copy of the repository:
#   powershell -ExecutionPolicy Bypass -File bridge\install.ps1
#
# Copies the bridge to %LOCALAPPDATA%\JungleLeopardBridge, adds it to the Startup folder and starts it.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$base = 'https://raw.githubusercontent.com/lencraft151-cloud/Jungle-Leopard-360-Watercool-addon-for-SignalRGB-/HEAD/bridge'
$target = Join-Path $env:LOCALAPPDATA 'JungleLeopardBridge'
$files = @('JungleLeopardBridge.cs', 'JungleLeopardBridge.ps1', 'uninstall.ps1')
$powershell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'

Write-Host 'Jungle Leopard LCD Bridge wird installiert ...'

# Stop a running bridge so its files can be replaced.
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
    Where-Object { $_.CommandLine -like '*JungleLeopardBridge.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

New-Item -ItemType Directory -Force -Path $target | Out-Null

$localSource = $null
if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot 'JungleLeopardBridge.cs'))) {
    $localSource = $PSScriptRoot
}

foreach ($file in $files) {
    $destination = Join-Path $target $file
    if ($localSource) {
        Copy-Item -Path (Join-Path $localSource $file) -Destination $destination -Force
    } else {
        Invoke-WebRequest -UseBasicParsing -Uri ($base + '/' + $file) -OutFile $destination
    }
}

$script = Join-Path $target 'JungleLeopardBridge.ps1'
$arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $script + '"'

$shortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Jungle Leopard LCD Bridge.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershell
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = $target
$shortcut.WindowStyle = 7
$shortcut.Description = 'Jungle Leopard LCD Bridge fuer SignalRGB'
$shortcut.Save()

Start-Process -FilePath $powershell -ArgumentList $arguments -WindowStyle Hidden

Write-Host ''
Write-Host 'Fertig. Die Bridge laeuft jetzt (Symbol unten rechts im Infobereich) und startet kuenftig mit Windows.'
Write-Host ('Installiert in: ' + $target)
