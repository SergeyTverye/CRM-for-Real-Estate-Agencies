param([Parameter(Mandatory)][string]$Installer, [string]$EvidenceDirectory = 'desktop-evidence')
$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Path $EvidenceDirectory -Force | Out-Null
$evidence=[IO.Path]::GetFullPath($EvidenceDirectory)
$install=Join-Path $env:LOCALAPPDATA 'Programs\RealEstateCRM-CI'
$data=Join-Path $env:LOCALAPPDATA 'RealEstateCRM'
$runtime=Join-Path $data 'logs\runtime.json'
function Check([bool]$condition,[string]$label) {
  if (-not $condition) { Add-Content -LiteralPath "$evidence\steps.log" -Value "FAIL $label"; throw "CHECK_FAILED:$label" }
  Add-Content -LiteralPath "$evidence\steps.log" -Value "PASS $label"
}
function WaitFor([scriptblock]$condition,[int]$seconds=180) {
  $end=(Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $end) { if (& $condition) { return }; Start-Sleep -Milliseconds 500 }
  throw 'WAIT_TIMEOUT'
}
function Install {
  $p=Start-Process -FilePath $Installer -ArgumentList @('/S',"/D=$install") -WindowStyle Hidden -PassThru -Wait
  Check ($p.ExitCode -eq 0) 'silent-install'
  Check (Test-Path -LiteralPath "$install\RealEstateCRM.exe") 'installed-exe'
}
function StartSmoke {
  $script:app=Start-Process -FilePath "$install\RealEstateCRM.exe" -ArgumentList @('--smoke','--smoke-seconds=180') -WindowStyle Hidden -PassThru
  WaitFor { (Test-Path -LiteralPath $runtime) -and -not $script:app.HasExited }
  $script:base=(Get-Content -Raw -LiteralPath $runtime | ConvertFrom-Json).url
  Check ($script:base -match '^http://127\.0\.0\.1:[0-9]+$') 'loopback-only'
  Check ((Invoke-WebRequest "$script:base/api/health/ready").StatusCode -eq 200) 'readiness-200'
  Check (-not $script:app.HasExited) 'smoke-process-running'
  $script:processes=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -eq "$install\RealEstateCRM.exe" -or $_.ExecutablePath.StartsWith("$install\app\",[StringComparison]::OrdinalIgnoreCase)) })
  $memory=0L
  foreach($owned in $script:processes) { $memory += (Get-Process -Id $owned.ProcessId -ErrorAction SilentlyContinue).WorkingSet64 }
  Add-Content -LiteralPath "$evidence\steps.log" -Value "METRIC smokeWorkingSetBytes=$memory"
}
function Api([string]$path,[string]$method='GET',$body=$null) {
  $options=@{Uri="$script:base$path";Method=$method;Headers=@{Origin=$script:base};WebSession=$script:session}
  if ($body) { $options.ContentType='application/json'; $options.Body=($body | ConvertTo-Json -Depth 10 -Compress) }
  Invoke-RestMethod @options
}
function Registration {
  $entries=@(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object DisplayName -eq 'RealEstateCRM')
  Check ($entries.Count -eq 1) 'single-HKCU-registration'
  foreach ($field in @('DisplayName','DisplayVersion','Publisher','DisplayIcon','InstallLocation','UninstallString')) { Check ([bool]$entries[0].$field) "registry-$field" }
  $script:uninstall=$entries[0].UninstallString.Trim('"')
  $start=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\RealEstateCRM\RealEstateCRM.lnk'
  Check (Test-Path -LiteralPath $start) 'start-menu-shortcut'
  Check (Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('Desktop')) 'RealEstateCRM.lnk')) 'silent-install-desktop-shortcut'
}
function Uninstall([bool]$purge) {
  $arguments=@('/S')
  if ($purge) { $arguments += @('/PURGE-DATA','/CONFIRM-PURGE') }
  $p=Start-Process -FilePath "$install\uninstall.exe" -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
  Check ($p.ExitCode -eq 0) 'silent-uninstall'
  WaitFor { -not (Test-Path -LiteralPath "$install\RealEstateCRM.exe") } 30
  WaitFor { @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object DisplayName -eq 'RealEstateCRM').Count -eq 0 } 30
  WaitFor { -not (Test-Path -LiteralPath $install) -or @(Get-ChildItem -LiteralPath $install -Force -Recurse -File).Count -eq 0 } 30
  $remaining=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -eq "$install\RealEstateCRM.exe" -or $_.ExecutablePath.StartsWith("$install\app\",[StringComparison]::OrdinalIgnoreCase)) })
  Check ($remaining.Count -eq 0) 'owned-processes-stopped'
  Check (-not (Test-Path -LiteralPath "$install\app\node\node.exe")) 'runtime-removed'
  Check (@(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object DisplayName -eq 'RealEstateCRM').Count -eq 0) 'uninstall-registration-removed'
  Check (-not (Test-Path -LiteralPath (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\RealEstateCRM\RealEstateCRM.lnk'))) 'shortcut-removed'
  foreach ($leaf in @('data','files','backups')) { Check ((Test-Path -LiteralPath (Join-Path $data $leaf)) -eq (-not $purge)) "retention-$leaf-purge-$purge" }
}
try {
  Install; StartSmoke; Registration
  $script:session=[Microsoft.PowerShell.Commands.WebRequestSession]::new()
  $password=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))+'z7'
  Api '/api/v1/desktop/setup' 'POST' @{login='director';displayName='Синтетический руководитель';password=$password;mode='empty';dataDirectory='default';localDiskConfirmed=$true} | Out-Null
  Api '/api/v1/auth/login' 'POST' @{login='director';password=$password} | Out-Null
  $client=Api '/api/v1/clients' 'POST' @{displayName='CI synthetic client';clientKind='person';contacts=@()}
  Check ([bool]$client.id) 'synthetic-client-created'
  Set-Content -LiteralPath (Join-Path $data 'files\ci-control.txt') -Value 'SYNTHETIC-CONTROL'
  $id=$client.id
  # Uninstall while the application is running exercises stop/Job Object cleanup.
  Uninstall $false
  Check ((Get-Content -Raw -LiteralPath (Join-Path $data 'files\ci-control.txt')).Trim() -eq 'SYNTHETIC-CONTROL') 'file-retained'
  Install; StartSmoke; Registration
  $script:session=[Microsoft.PowerShell.Commands.WebRequestSession]::new()
  Api '/api/v1/auth/login' 'POST' @{login='director';password=$password} | Out-Null
  $restored=Api "/api/v1/clients/$id"
  Check ([bool]$restored) 'client-retained-after-reinstall'
  Check ((Api '/api/v1/desktop/setup').available -eq $false) 'setup-closed-after-reinstall'
  # Check upgrade over an existing install, including protective backup.
  Start-Process -FilePath "$install\RealEstateCRM.exe" -ArgumentList '--shutdown' -WindowStyle Hidden -Wait | Out-Null
  WaitFor { -not (Test-Path -LiteralPath $runtime) } 30
  Set-Content -LiteralPath (Join-Path $data 'data\desktop-version.json') -Value '{"version":"3.2.0-synthetic"}'
  Install; StartSmoke
  Check (@(Get-ChildItem -LiteralPath (Join-Path $data 'backups') -Filter '*.crmbackup').Count -gt 0) 'pre-upgrade-encrypted-snapshot'
  $script:session=[Microsoft.PowerShell.Commands.WebRequestSession]::new()
  Api '/api/v1/auth/login' 'POST' @{login='director';password=$password} | Out-Null
  Check ([bool](Api "/api/v1/clients/$id")) 'client-retained-after-overinstall'
  # Only allowlisted, secret-free codes leave the runner; server/HTTP bodies never exported.
  if (Test-Path -LiteralPath (Join-Path $data 'logs\supervisor.log')) {
    Get-Content -LiteralPath (Join-Path $data 'logs\supervisor.log') |
      Where-Object { $_ -match '^(READY http://127\.0\.0\.1:[0-9]+|STOPPED|DESKTOP_START_FAILED|CHILD_EXIT:[a-z-]+:[0-9]+)$' } |
      Set-Content -LiteralPath "$evidence\supervisor-codes.log"
  }
  Uninstall $true
  Check (-not (Test-Path -LiteralPath (Join-Path $data 'files\ci-control.txt'))) 'control-file-purged'
  $os=Get-CimInstance Win32_OperatingSystem
  @{os=$os.Caption; build=$os.BuildNumber; memoryBytes=([long]$os.TotalVisibleMemorySize*1024); processor=$env:PROCESSOR_ARCHITECTURE} | ConvertTo-Json | Set-Content -LiteralPath "$evidence\runner.json"
  Add-Content -LiteralPath "$evidence\steps.log" -Value 'PASS installer-lifecycle-complete'
} catch {
  Add-Content -LiteralPath "$evidence\steps.log" -Value ('FAILED '+$_.FullyQualifiedErrorId.Split(',')[0])
  throw 'INSTALLER_LIFECYCLE_FAILED_SEE_SAFE_CODES'
} finally { $password=$null }
