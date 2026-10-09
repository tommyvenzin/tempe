param([ValidateSet('Desk','RDP','Online')][string]$Mode = 'Desk', [switch]$NoHandOver)
$ErrorActionPreference = 'Stop'
# Auto-update (2.2.0+): the helper installs newer versions under
# %LOCALAPPDATA%\TempeMobileCostar\packages and points current.txt at the newest one.
# An older package folder hands over to it, so existing folders and shortcuts start the
# newest installed version. A missing or broken pointer never stops this version starting.
function Get-PackageVersion([string]$Folder) {
    try { return [version]((Get-Content -LiteralPath (Join-Path $Folder 'VERSION.txt') -ErrorAction Stop | Select-Object -First 1).Trim()) }
    catch { return [version]'0.0.0' }
}
if (-not $NoHandOver) {
    try {
        $pointer = Join-Path $env:LOCALAPPDATA 'TempeMobileCostar\packages\current.txt'
        if (Test-Path -LiteralPath $pointer) {
            $target = ((Get-Content -LiteralPath $pointer | Select-Object -First 1) + '').Trim()
            $here = (Resolve-Path -LiteralPath $PSScriptRoot).Path.TrimEnd('\')
            if ($target -and (Test-Path -LiteralPath (Join-Path $target 'Launch.ps1')) -and ($target.TrimEnd('\') -ne $here) -and
                ((Get-PackageVersion $target) -gt (Get-PackageVersion $PSScriptRoot))) {
                Write-Host ('Starting the newer installed helper: ' + $target)
                & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $target 'Launch.ps1') -Mode $Mode -NoHandOver
                exit $LASTEXITCODE
            }
        }
    } catch { }
}
$stage = 'Build and self-tests'
$runtime = $null
try {
    $runtime = & (Join-Path $PSScriptRoot 'Build.ps1') -PassThru
    if (!$runtime -or !(Test-Path -LiteralPath $runtime.Executable)) { throw 'Build did not provide an executable path.' }
    $exe = $runtime.Executable
    if ($Mode -eq 'RDP' -or $Mode -eq 'Online') {
        $stage = 'Import the supplied worker connection file'
        $connection = Join-Path $PSScriptRoot 'worker-connection.json'
        if (Test-Path -LiteralPath $connection) { Copy-Item -LiteralPath $connection -Destination (Join-Path $runtime.Bin 'worker-connection.json') -Force }
        $modeArgument = if ($Mode -eq 'Online') { '--online' } else { '--worker' }
    }
    else { $modeArgument = '--desk' }
    $stage = 'Start the ' + $Mode + ' helper'
    Start-Process -FilePath $exe -WorkingDirectory $runtime.Bin -ArgumentList $modeArgument
} catch {
    $message = 'Launch failed during "' + $stage + '": ' + $_.Exception.Message
    if ($runtime -and $runtime.StartupLog) {
        try { $message | Add-Content -LiteralPath $runtime.StartupLog -Encoding UTF8 } catch { }
        $message += [Environment]::NewLine + 'Startup report: ' + $runtime.StartupLog
    }
    # 2.3.0+: an installed update that cannot build or pass its self-tests on this PC must not
    # stay the version every shortcut hands over to. Its pointer is set aside first. Then, if an
    # earlier version was installed the same way (it has run on this PC), the pointer goes back
    # to the newest of those, so the usual shortcut starts that version again.
    if ($stage -eq 'Build and self-tests') {
        try {
            $pointer = Join-Path $env:LOCALAPPDATA 'TempeMobileCostar\packages\current.txt'
            if (Test-Path -LiteralPath $pointer) {
                $target = ((Get-Content -LiteralPath $pointer | Select-Object -First 1) + '').Trim().TrimEnd('\')
                $here = (Resolve-Path -LiteralPath $PSScriptRoot).Path.TrimEnd('\')
                if ($target -eq $here) {
                    Move-Item -LiteralPath $pointer -Destination ($pointer + '.failed') -Force
                    $fallback = 'the previous version'
                    try {
                        $mine = Get-PackageVersion $PSScriptRoot
                        $previous = @(Get-ChildItem -LiteralPath (Split-Path -Parent $pointer) -ErrorAction Stop |
                            Where-Object { $_.PSIsContainer -and $_.Name -like 'Tempe-COSTAR-Helper-v*' -and $_.FullName.TrimEnd('\') -ne $here -and
                                (Test-Path -LiteralPath (Join-Path $_.FullName 'Launch.ps1')) -and
                                (Get-PackageVersion $_.FullName) -gt [version]'0.0.0' -and (Get-PackageVersion $_.FullName) -lt $mine } |
                            Sort-Object -Property @{ Expression = { Get-PackageVersion $_.FullName } } -Descending)
                        if ($previous.Count -gt 0) {
                            [IO.File]::WriteAllText($pointer, $previous[0].FullName)
                            $fallback = 'version ' + (Get-PackageVersion $previous[0].FullName)
                        }
                    } catch { }
                    $message += [Environment]::NewLine + [Environment]::NewLine + 'This update could not start on this PC, so it has been set aside: your usual shortcut starts ' + $fallback + ' again. Send the startup report to Claude.'
                }
            }
        } catch { }
    }
    Write-Host $message -ForegroundColor Red
    exit 1
}
