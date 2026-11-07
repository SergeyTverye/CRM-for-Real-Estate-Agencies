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
  $runtimeRoots=@('.next-desktop','chromium','generated','import-profiles','node','node_modules','prisma','public','templates','workers',
    'backup-command.cjs','backup-now.cjs','desktop-manifest.json','graceful.cjs','init-db.cjs','package.json','RUNTIMES.md','sbom.cdx.json','server.js','supervisor.mjs','upgrade.cjs')
  Check (@(Get-ChildItem -LiteralPath "$install\app" -Force | Where-Object Name -notin $runtimeRoots).Count -eq 0) 'installed-runtime-root-allowlist'
}
function StartSmoke {
  # A crash can leave the previous ready marker. Never accept its port/PID.
  if (Test-Path -LiteralPath $runtime) { Remove-Item -LiteralPath $runtime -Force }
  $script:app=Start-Process -FilePath "$install\RealEstateCRM.exe" -ArgumentList @('--smoke','--smoke-seconds=180') -WindowStyle Hidden -PassThru
  WaitFor {
    if ($script:app.HasExited) { throw 'SMOKE_EXIT_BEFORE_READY' }
    try {
      $info=Get-Content -Raw -LiteralPath $runtime -ErrorAction Stop | ConvertFrom-Json
      if ($info.url -notmatch '^http://127\.0\.0\.1:[0-9]+$') { return $false }
      $owner=Get-CimInstance Win32_Process -Filter "ProcessId=$($info.pid)"
      if (-not $owner -or $owner.ParentProcessId -ne $script:app.Id -or $owner.ExecutablePath -ne "$install\app\node\node.exe") { return $false }
      if ((Invoke-WebRequest "$($info.url)/api/health/ready" -TimeoutSec 3).StatusCode -ne 200) { return $false }
      $script:base=$info.url
      return $true
    } catch { return $false }
  }
  Check ($script:base -match '^http://127\.0\.0\.1:[0-9]+$') 'loopback-only'
  Check ((Invoke-WebRequest "$script:base/api/health/ready").StatusCode -eq 200) 'readiness-200'
  Check (-not $script:app.HasExited) 'smoke-process-running'
  $script:processes=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -eq "$install\RealEstateCRM.exe" -or $_.ExecutablePath.StartsWith("$install\app\",[StringComparison]::OrdinalIgnoreCase)) })
  $memory=0L
  foreach($owned in $script:processes) { $memory += (Get-Process -Id $owned.ProcessId -ErrorAction SilentlyContinue).WorkingSet64 }
  Add-Content -LiteralPath "$evidence\steps.log" -Value "METRIC smokeWorkingSetBytes=$memory"
}
function Api([string]$path,[string]$method='GET',$body=$null) {
  $options=@{Uri="$script:base$path";Method=$method;Headers=@{Origin=$script:base};WebSession=$script:session;TimeoutSec=30}
  if ($body) { $options.ContentType='application/json'; $options.Body=($body | ConvertTo-Json -Depth 10 -Compress) }
  Invoke-RestMethod @options
}
function StartDesktop {
  Start-Process -FilePath "$install\RealEstateCRM.exe" -ArgumentList '--shutdown' -WindowStyle Hidden -Wait | Out-Null
  WaitFor { $script:app.HasExited -and -not (Test-Path -LiteralPath $runtime) } 210
  $nativeLog=Join-Path $data 'logs\native-startup.log'
  if (Test-Path -LiteralPath $nativeLog) { Remove-Item -LiteralPath $nativeLog -Force }
  $script:app=Start-Process -FilePath "$install\RealEstateCRM.exe" -PassThru
  WaitFor {
    if ($script:app.HasExited) { throw 'DESKTOP_EXIT_BEFORE_WEBVIEW' }
    $script:app.Refresh()
    # Require the actual native window, not merely a Chromium child process.
    # Chromium helpers need not all be direct children of the Tauri process.
    $created=(Test-Path -LiteralPath $nativeLog) -and (@(Get-Content -LiteralPath $nativeLog) -contains 'WINDOW_CREATED')
    $created -and $script:app.MainWindowHandle -ne [IntPtr]::Zero
  }
  Check (-not $script:app.HasExited) 'real-tauri-window-running'
  $info=Get-Content -Raw -LiteralPath $runtime | ConvertFrom-Json
  Check ($info.url -match '^http://127\.0\.0\.1:[0-9]+$') 'desktop-loopback-only'
  Check ((Invoke-WebRequest "$($info.url)/api/health/ready" -TimeoutSec 3).StatusCode -eq 200) 'desktop-readiness-200'
  Check (Test-Path -LiteralPath (Join-Path $data 'data\webview')) 'owned-webview-profile'
  $before=(Get-Content -Raw -LiteralPath $runtime | ConvertFrom-Json).pid
  $second=Start-Process -FilePath "$install\RealEstateCRM.exe" -WindowStyle Hidden -PassThru
  WaitFor { $second.HasExited } 30
  Check ($second.ExitCode -eq 0 -and -not $script:app.HasExited) 'second-launch-focuses-existing-instance'
  Check ((Get-Content -Raw -LiteralPath $runtime | ConvertFrom-Json).pid -eq $before) 'second-launch-keeps-supervisor'
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
  $p=Start-Process -FilePath $script:uninstall -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
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
  # This destructive lifecycle harness is only for a disposable, empty profile.
  Check (-not (Test-Path -LiteralPath $data)) 'empty-synthetic-data-profile-required'
  Check (-not (Test-Path -LiteralPath $install)) 'empty-install-directory-required'
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
  Check ($restored.id -eq $id -and $restored.displayName -eq 'CI synthetic client') 'client-retained-after-reinstall'
  Check ((Api '/api/v1/desktop/setup').available -eq $false) 'setup-closed-after-reinstall'
  # Check upgrade over an existing install, including protective backup.
  Start-Process -FilePath "$install\RealEstateCRM.exe" -ArgumentList '--shutdown' -WindowStyle Hidden -Wait | Out-Null
  WaitFor { $script:app.HasExited -and -not (Test-Path -LiteralPath $runtime) } 210
  Set-Content -LiteralPath (Join-Path $data 'data\desktop-version.json') -Value '{"version":"3.2.0-synthetic"}'
  # Simulate resources shipped by an older bundle, absent from the new policy.
  Set-Content -LiteralPath "$install\app\package-lock.json" -Value '{"syntheticObsolete":true}'
  New-Item -ItemType Directory -Path "$install\app\templates" -Force | Out-Null
  Set-Content -LiteralPath "$install\app\templates\obsolete-ci-example.txt" -Value 'SYNTHETIC-OBSOLETE'
  Install; StartSmoke
  Check (-not (Test-Path -LiteralPath "$install\app\package-lock.json")) 'overinstall-obsolete-lock-removed'
  Check (-not (Test-Path -LiteralPath "$install\app\templates\obsolete-ci-example.txt")) 'overinstall-obsolete-template-removed'
  Check ((Get-Content -Raw -LiteralPath (Join-Path $data 'files\ci-control.txt')).Trim() -eq 'SYNTHETIC-CONTROL') 'overinstall-user-file-retained'
  Check (@(Get-ChildItem -LiteralPath (Join-Path $data 'backups') -Filter '*.crmbackup').Count -gt 0) 'pre-upgrade-encrypted-snapshot'
  $script:session=[Microsoft.PowerShell.Commands.WebRequestSession]::new()
  Api '/api/v1/auth/login' 'POST' @{login='director';password=$password} | Out-Null
  Check ([bool](Api "/api/v1/clients/$id")) 'client-retained-after-overinstall'
  # --smoke bypasses WebView. Exercise the actual Tauri window and singleton too.
  StartDesktop
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
  $nativeLog=Join-Path $data 'logs\native-startup.log'
  if (Test-Path -LiteralPath $nativeLog) {
    Get-Content -LiteralPath $nativeLog | Where-Object { $_ -match '^(SERVER_READY|WINDOW_BUILD_STARTED|WINDOW_CREATED|WINDOW_BUILD_FAILED|WINDOW_DISPATCH_FAILED)$' } |
      Set-Content -LiteralPath "$evidence\native-startup-codes.log"
  }
  Add-Content -LiteralPath "$evidence\steps.log" -Value ('FAILED '+$_.FullyQualifiedErrorId.Split(',')[0])
  throw 'INSTALLER_LIFECYCLE_FAILED_SEE_SAFE_CODES'
} finally { $password=$null }
