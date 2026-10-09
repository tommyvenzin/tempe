param([switch]$CheckOnly, [switch]$PassThru)
$ErrorActionPreference = 'Stop'
$stage = 'Create local build folder'
$startupLog = $null
try {
    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { throw 'Windows did not provide LOCALAPPDATA for this user.' }
    $appFolder = Join-Path $env:LOCALAPPDATA 'TempeMobileCostar'
    [IO.Directory]::CreateDirectory($appFolder) | Out-Null
    $startupLog = Join-Path $appFolder ('startup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $PID + '.txt')
    @('Tempe helper 2.3.0 startup', ('Source: ' + $PSScriptRoot), ('Local data: ' + $appFolder)) | Set-Content -LiteralPath $startupLog -Encoding UTF8
    $stage = 'Read helper source files'
    $requiredSources = @('CostarAutofill.cs','CostarSession.cs','DesktopUi.cs','Diagnostics.cs','LocalHttp.cs','MobileModel.cs','MobileRunner.cs','MobileTests.cs','OrderModel.cs','Program.cs','ResourceBudget.cs','Worker.cs','OrderCheck.cs','Updater.cs')
    $sourceRoot = Join-Path $PSScriptRoot 'Source'
    $missingSources = @($requiredSources | Where-Object { !(Test-Path -LiteralPath (Join-Path $sourceRoot $_) -PathType Leaf) })
    if ($missingSources.Count -gt 0) { throw ('The helper folder is incomplete. Missing Source files: ' + ($missingSources -join ', ') + '. Extract the complete v2.3.0 ZIP into a fresh folder and run Start-RDP.cmd from there.') }
    $sourceFiles = @($requiredSources | ForEach-Object { Get-Item -LiteralPath (Join-Path $sourceRoot $_) })
    $resourceSource = Join-Path $PSScriptRoot 'Source\qr.js'
    $websiteFiles = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'Website') -File -Recurse | Sort-Object FullName)
    if ($sourceFiles.Count -eq 0 -or !(Test-Path -LiteralPath $resourceSource) -or $websiteFiles.Count -eq 0) { throw 'Extract the complete helper ZIP, including Source and Website.' }
    $fingerprintInputs = @($sourceFiles.FullName) + @($resourceSource, $PSCommandPath) + @($websiteFiles.FullName)
    $fingerprint = ($fingerprintInputs | ForEach-Object { (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash }) -join ''
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $buildId = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($fingerprint)))).Replace('-', '').Substring(0, 20) }
    finally { $sha.Dispose() }
    # A source-specific local directory avoids network execution and overwriting
    # the EXE of an older helper that is still open. Settings are stored elsewhere.
    $runtimeFolder = Join-Path $appFolder ('runtime\' + $buildId)
    $bin = Join-Path $runtimeFolder 'bin'
    $localSource = Join-Path $runtimeFolder 'Source'
    $stage = 'Copy build files to the local user folder'
    [IO.Directory]::CreateDirectory($bin) | Out-Null
    [IO.Directory]::CreateDirectory($localSource) | Out-Null
    foreach ($sourceFile in $sourceFiles) { Copy-Item -LiteralPath $sourceFile.FullName -Destination (Join-Path $localSource $sourceFile.Name) -Force }
    Copy-Item -LiteralPath $resourceSource -Destination (Join-Path $localSource 'qr.js') -Force
    $localWebsite = Join-Path $runtimeFolder 'Website'
    [IO.Directory]::CreateDirectory($localWebsite) | Out-Null
    foreach ($websiteFile in $websiteFiles) {
        $websiteRoot = (Join-Path $PSScriptRoot 'Website').TrimEnd('\')
        $relative = $websiteFile.FullName.Substring($websiteRoot.Length).TrimStart('\')
        $destination = Join-Path $localWebsite $relative
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
        Copy-Item -LiteralPath $websiteFile.FullName -Destination $destination -Force
    }
    Write-Host ('Local build folder: ' + $runtimeFolder)
    ('Build: ' + $runtimeFolder) | Add-Content -LiteralPath $startupLog -Encoding UTF8
    $stage = 'Locate the Windows C# compiler'
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    if (!(Test-Path $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
    if (!(Test-Path $compiler)) { throw 'The Windows .NET Framework compiler is unavailable. Send this message; no software has been installed.' }
    $sources = @($requiredSources | ForEach-Object { Join-Path $localSource $_ })
    $resource = Join-Path $localSource 'qr.js'
    $exe = Join-Path $bin 'TempeMobile.exe'
    $stamp = Join-Path $bin 'build.sha256'
    if (!(Test-Path $exe) -or !(Test-Path $stamp) -or ([IO.File]::ReadAllText($stamp) -ne $fingerprint)) {
        $stage = 'Compile the helper locally'
        $refs = @('System.dll','System.Core.dll','System.Windows.Forms.dll','System.Drawing.dll','System.Web.dll','System.Web.Extensions.dll','System.Security.dll','System.IO.Compression.dll','System.IO.Compression.FileSystem.dll','Accessibility.dll')
        $arguments = @('/nologo','/target:winexe','/platform:anycpu','/langversion:5','/codepage:65001',('/out:' + $exe),('/resource:' + $resource + ',TempeQR.js'))
        $arguments += $refs | ForEach-Object { '/reference:' + $_ }
        Push-Location -LiteralPath $bin
        try {
            & $compiler @arguments @sources | Tee-Object -FilePath (Join-Path $bin 'compiler-output.txt') | Out-Host
            if ($LASTEXITCODE -ne 0) { throw ('The C# compiler exited with code ' + $LASTEXITCODE + '. See compiler-output.txt in the local bin folder and the error above.') }
        } finally { Pop-Location }
        [IO.File]::WriteAllText($stamp, $fingerprint)
    }
    $stage = 'Run the Windows self-tests'
    $report = Join-Path $bin 'self-test-results.txt'
    $testStamp = Join-Path $bin 'self-test.sha256'
    $exeHash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
    $needsTest = $CheckOnly -or !(Test-Path -LiteralPath $testStamp) -or !(Test-Path -LiteralPath $report)
    if (!$needsTest) { $needsTest = [IO.File]::ReadAllText($testStamp) -ne $exeHash }
    if ($needsTest) {
        if (Test-Path -LiteralPath $testStamp) { Remove-Item -LiteralPath $testStamp -Force }
        if (Test-Path -LiteralPath $report) { Remove-Item -LiteralPath $report -Force }
        $test = Start-Process -FilePath $exe -WorkingDirectory $bin -ArgumentList @('--self-test', ('"' + $report + '"')) -PassThru -Wait
        try {
            if (!(Test-Path -LiteralPath $report)) { throw ('The self-test process exited with code ' + $test.ExitCode + ' without a report. Windows may have blocked startup; check the exact error with IT.') }
            Get-Content -LiteralPath $report | Out-Host
            if ($test.ExitCode -ne 0) { throw 'Self-tests failed. COSTAR was not changed.' }
            [IO.File]::WriteAllText($testStamp, $exeHash)
        } finally { $test.Dispose() }
    } else { Write-Host 'Reusing passing self-tests for this unchanged executable. Check-Build.cmd forces a fresh run.' }
    'Build and self-tests passed.' | Add-Content -LiteralPath $startupLog -Encoding UTF8
    Write-Host ('Build and self-tests passed. Report: ' + $report) -ForegroundColor Green
    if ($PassThru) { [pscustomobject]@{ Executable=$exe; Bin=$bin; Root=$runtimeFolder; Report=$report; StartupLog=$startupLog } }
} catch {
    $message = 'Startup failed during "' + $stage + '": ' + $_.Exception.Message
    if ($startupLog) {
        try { @($message, $_.ScriptStackTrace) | Add-Content -LiteralPath $startupLog -Encoding UTF8 } catch { }
        $message += [Environment]::NewLine + 'Startup report: ' + $startupLog
    }
    throw $message
}
