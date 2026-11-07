# Jungle Leopard LCD Bridge
#
# Runs in the background with a tray icon and forwards the frames the SignalRGB plugin sends over
# UDP (127.0.0.1:48960) to the display's COM port. Started at logon by the shortcut install.ps1 creates.
#
#   -Console   run in this window and show the status instead of a tray icon (for troubleshooting)
#
# A file "port.txt" next to this script containing e.g. "COM5" overrides the automatic port search.
param([switch]$Console)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$logFile = Join-Path $here 'bridge.log'

$mutex = New-Object System.Threading.Mutex($false, 'Local\JungleLeopardLcdBridge')
if (-not $mutex.WaitOne(0)) {
    if ($Console) { Write-Host 'Die Bridge laeuft bereits (Symbol im Infobereich).' }
    return
}

try {
    if (-not ('JungleLeopard.Bridge' -as [type])) {
        Add-Type -Path (Join-Path $here 'JungleLeopardBridge.cs')
    }
} catch {
    Add-Content -Path $logFile -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  Compile error: ' + $_)
    throw
}

$bridge = New-Object JungleLeopard.Bridge
$bridge.LogFile = $logFile

$portFile = Join-Path $here 'port.txt'
if (Test-Path $portFile) {
    $bridge.PortOverride = (Get-Content $portFile -Raw).Trim()
}

try {
    $bridge.Start()
} catch {
    Add-Content -Path $logFile -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  Start failed: ' + $_)
    throw
}

if ($Console) {
    Write-Host 'Jungle Leopard LCD Bridge laeuft. Strg+C beendet sie.'
    try {
        while ($true) {
            Start-Sleep -Seconds 1
            Write-Host -NoNewline ("`r" + $bridge.StatusText + ' | Nachrichten: ' + $bridge.Messages + '          ')
        }
    } finally {
        $bridge.Stop()
        $mutex.ReleaseMutex()
    }
    return
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = [System.Drawing.SystemIcons]::Information
$tray.Text = 'Jungle Leopard LCD Bridge'
$tray.Visible = $true

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$null = $menu.Items.Add('Log anzeigen', $null, {
    Start-Process -FilePath 'notepad.exe' -ArgumentList ('"' + $logFile + '"')
})
$null = $menu.Items.Add('Beenden', $null, {
    $timer.Stop()
    $bridge.Stop()
    $tray.Visible = $false
    [System.Windows.Forms.Application]::Exit()
})
$tray.ContextMenuStrip = $menu

$script:lastState = ''
$timer.add_Tick({
    $text = 'Jungle Leopard LCD: ' + $bridge.StatusText
    if ($text.Length -gt 63) { $text = $text.Substring(0, 63) }
    $tray.Text = $text

    $state = $bridge.State
    if ($state -ne $script:lastState) {
        if ($state -eq 'noport' -or $state -eq 'error') {
            $tray.ShowBalloonTip(5000, 'Jungle Leopard LCD', $bridge.StatusText, [System.Windows.Forms.ToolTipIcon]::Warning)
        } elseif ($state -eq 'connected') {
            $tray.ShowBalloonTip(3000, 'Jungle Leopard LCD', $bridge.StatusText, [System.Windows.Forms.ToolTipIcon]::Info)
        }
        $script:lastState = $state
    }
})
$timer.Start()

[System.Windows.Forms.Application]::Run()
$mutex.ReleaseMutex()
