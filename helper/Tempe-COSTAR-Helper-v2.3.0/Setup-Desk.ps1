$ErrorActionPreference = 'Stop'
try {
    $runtime = & (Join-Path $PSScriptRoot 'Build.ps1') -PassThru
    if (!$runtime -or !(Test-Path -LiteralPath $runtime.Executable)) { throw 'Build did not provide an executable path.' }
    $addresses = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
        $_.AddressState -eq 'Preferred' -and ($_.IPAddress -match '^10\.' -or $_.IPAddress -match '^192\.168\.' -or $_.IPAddress -match '^172\.(1[6-9]|2[0-9]|3[01])\.')
    } | Sort-Object InterfaceIndex,IPAddress)
    if ($addresses.Count -eq 0) { throw 'No private LAN IPv4 address found. Connect your desk PC to the work network.' }
    if ($addresses.Count -eq 1) { $chosen = $addresses[0] } else {
        for ($i=0; $i -lt $addresses.Count; $i++) { Write-Host ("{0}: {1}  {2}" -f ($i+1),$addresses[$i].IPAddress,$addresses[$i].InterfaceAlias) }
        $selection = Read-Host 'Choose the Ethernet/work LAN address number'
        $number = 0
        if (![int]::TryParse($selection,[ref]$number) -or $number -lt 1 -or $number -gt $addresses.Count) { throw 'Invalid address selection.' }
        $chosen = $addresses[$number-1]
    }
    $ip = $chosen.IPAddress
    $folder = Join-Path $env:LOCALAPPDATA 'TempeMobileCostar\desk'
    [IO.Directory]::CreateDirectory($folder) | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $root = New-SelfSignedCertificate -Type Custom -Subject ("CN=Tempe Mobile Local Root " + $stamp) -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy NonExportable -KeyUsage CertSign,CRLSign -TextExtension @('2.5.29.19={critical}{text}ca=1&pathlength=1') -CertStoreLocation 'Cert:\CurrentUser\My' -NotAfter (Get-Date).AddYears(3)
    $leaf = New-SelfSignedCertificate -Type Custom -Subject ("CN=" + $ip) -Signer $root -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy NonExportable -KeyUsage DigitalSignature,KeyEncipherment -TextExtension @(("2.5.29.17={text}IPAddress=" + $ip),'2.5.29.37={text}1.3.6.1.5.5.7.3.1','2.5.29.19={critical}{text}ca=0') -CertStoreLocation 'Cert:\CurrentUser\My' -NotAfter (Get-Date).AddDays(365)
    $public = Join-Path $folder 'Tempe-Mobile-Root.cer'
    Export-Certificate -Cert $root -FilePath $public -Force | Out-Null
    # Trust only this newly generated local certificate for the current Windows user.
    Import-Certificate -FilePath $public -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
    $exe = $runtime.Executable
    $init = Start-Process -FilePath $exe -WorkingDirectory $runtime.Bin -ArgumentList @('--init',$ip,$leaf.Thumbprint,('"'+$public+'"')) -PassThru -Wait
    if ($init.ExitCode -ne 0) { throw 'Receiver setup did not finish.' }
    Write-Host ('Setup complete for ' + $ip + '. Keep this PC address while paired.') -ForegroundColor Green
    Start-Process -FilePath $exe -WorkingDirectory $runtime.Bin -ArgumentList '--desk'
} catch { Write-Host $_.Exception.ToString() -ForegroundColor Red; exit 1 }
