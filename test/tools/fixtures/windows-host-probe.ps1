param([string]$Source, [string]$Node, [string]$Fixture, [string]$Directory)
$ErrorActionPreference = 'Stop'
Add-Type -Path $Source
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class ConsoleWindows {
    delegate bool Callback(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr parameter);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder name, int count);
    public static long[] Visible() {
        var windows = new List<long>();
        EnumWindows((window, parameter) => {
            var name = new StringBuilder(256); GetClassName(window, name, 256);
            if (IsWindowVisible(window) && (name.ToString() == "ConsoleWindowClass" || name.ToString() == "CASCADIA_HOSTING_WINDOW_CLASS"))
                windows.Add(window.ToInt64());
            return true;
        }, IntPtr.Zero);
        return windows.ToArray();
    }
}
'@
$before = @([ConsoleWindows]::Visible())
$server = $null
try {
    $server = New-Object WindowsServerHost($Node, "`"$Fixture`" `"$Directory`"", $Directory,
        (Join-Path $Directory 'stdout.log'), (Join-Path $Directory 'stderr.log'))
    $server.Resume()
    $visible = @{}
    for ($i = 0; $i -lt 100; $i++) {
        foreach ($window in [ConsoleWindows]::Visible()) {
            if ($before -notcontains $window) { $visible[$window] = $true }
        }
        if ((Test-Path (Join-Path $Directory 'module.pid')) -and
            (Test-Path (Join-Path $Directory 'detached.pid'))) { break }
        Start-Sleep -Milliseconds 50
    }
    @{ visible = @($visible.Keys); launcher = $server.Pid } | ConvertTo-Json -Compress |
        Set-Content -LiteralPath (Join-Path $Directory 'ready.json') -Encoding UTF8
    # JS test kills this host, bypassing finally. Kernel job cleanup must still
    # terminate the shim, ordinary module, and detached descendant.
    $server.Wait()
} finally {
    if ($server) { $server.Dispose() }
}
