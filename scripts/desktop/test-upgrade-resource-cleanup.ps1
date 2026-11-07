# Source and synthetic fixtures ONLY. No installed EXE, profile or processes used.
$ErrorActionPreference = 'Stop'
$helper = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../src-tauri/windows/upgrade-resource-cleanup.ps1'))
$tempBase = if ($env:GITHUB_ACTIONS -eq 'true') { $env:RUNNER_TEMP } else { 'D:\TEMP\UserTEMP\opencode' }
$root = Join-Path $tempBase ('crm-resource-cleanup-synthetic-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$global:CrmSyntheticCleanupTestState = @{ shutdownCalls = 0; running = $false; shutdownCode = 0; spawnFails = $false; processes = @(); sleeps = 0; afterShutdown = $null }
function Start-Process {
  param($FilePath,$ArgumentList,[switch]$PassThru,$WindowStyle,$WorkingDirectory)
  if (-not $FilePath.StartsWith($root+'\') -or $ArgumentList -ne '--shutdown') { throw 'TEST_REAL_PROCESS_FORBIDDEN' }
  $global:CrmSyntheticCleanupTestState.shutdownCalls++
  if ($global:CrmSyntheticCleanupTestState.spawnFails) { throw 'SYNTHETIC_SPAWN_FAILURE' }
  if ($global:CrmSyntheticCleanupTestState.afterShutdown) { & $global:CrmSyntheticCleanupTestState.afterShutdown | Out-Host }
  $process = [pscustomobject]@{ ExitCode = $global:CrmSyntheticCleanupTestState.shutdownCode }
  $process | Add-Member ScriptMethod WaitForExit { param($timeout) return $true }
  return $process
}
function Get-CimInstance {
  param($ClassName)
  if ($ClassName -ne 'Win32_Process') { throw 'TEST_CIM_FORBIDDEN' }
  if ($global:CrmSyntheticCleanupTestState.running) { throw 'TEST_PROCESS_QUERY_FAILURE' }
  return $global:CrmSyntheticCleanupTestState.processes
}
function Start-Sleep {
  param($Milliseconds)
  if ($Milliseconds -ne 250) { throw 'TEST_SLEEP_UNEXPECTED' }
  $global:CrmSyntheticCleanupTestState.sleeps++
  if ($global:CrmSyntheticCleanupTestState.sleeps -gt 2) { throw 'TEST_WAIT_NOT_BOUNDED' }
  $global:CrmSyntheticCleanupTestState.processes = @()
}
function Check($condition,$label) { if (-not $condition) { throw "FAIL:$label" }; Write-Output "PASS $label" }
function Fixture([string]$name) {
  $dir = Join-Path $root $name
  New-Item -ItemType Directory -Path "$dir\app\node","$dir\app\templates" -Force | Out-Null
  foreach ($file in @('RealEstateCRM.exe','app\node\node.exe','app\supervisor.mjs','app\package-lock.json','app\templates\obsolete.txt')) {
    Set-Content -LiteralPath "$dir\$file" -Value 'SYNTHETIC'
  }
  Set-Content -LiteralPath "$dir\app\desktop-manifest.json" -Value '{"version":"3.2.0","node":"24.15.0","initEntry":"scripts/desktop/init-db.ts","backupEntry":"scripts/desktop/runtime/backup-worker.ts"}'
  return $dir
}
function Reject([string]$dir,[string]$code,[string]$installer = "$root\setup.exe") {
  $caught = $false
  try { & $helper -InstallDirectory $dir -InstallerPath $installer | Out-Null }
  catch { $caught = $_.Exception.Message -eq $code }
  Check $caught $code
}
try {
  Set-Content -LiteralPath "$root\setup.exe" -Value 'SYNTHETIC'
  New-Item -ItemType Directory -Path "$root\external\files" -Force | Out-Null
  Set-Content -LiteralPath "$root\external\files\control.txt" -Value 'SYNTHETIC-CONTROL'
  $dir = Fixture 'upgrade'
  Set-Content -LiteralPath "$dir\unrelated.txt" -Value 'SYNTHETIC-KEEP'
  & $helper -InstallDirectory $dir -InstallerPath "$root\setup.exe"
  Check (-not (Test-Path -LiteralPath "$dir\app")) 'obsolete-runtime-tree-removed'
  Check ((Test-Path -LiteralPath "$dir\RealEstateCRM.exe") -and (Test-Path -LiteralPath "$dir\unrelated.txt")) 'install-root-not-wiped'
  Check ((Get-Content -LiteralPath "$root\external\files\control.txt") -eq 'SYNTHETIC-CONTROL') 'outside-files-unchanged'
  & $helper -InstallDirectory $dir -InstallerPath "$root\setup.exe"
  Check ($global:CrmSyntheticCleanupTestState.shutdownCalls -eq 1) 'fresh-or-already-uninstalled-no-double-cleanup'
  # Reinstall replenishes the same tree; a second overinstall must work too.
  $dir = Fixture 'upgrade'
  & $helper -InstallDirectory $dir -InstallerPath "$root\setup.exe"
  Check (-not (Test-Path -LiteralPath "$dir\app")) 'reinstall-overinstall'
  foreach ($relative in @('ClientBase.xlsx','Contract.docx','Scan.pdf','photo.jpg','archive.zip','notes.md','AGENTS.md','CLAUDE.md',
      'MyDocs\notes.txt','custom\source.ts','templates\my-contract.docx','templates\examples\user.xlsx','templates\obsolete-user.txt',
      'public\logo.png','public\custom.txt','public\nested\notes.md','generated\customers.csv',
      'node_modules\demo\.env','node_modules\demo\crm.db','chromium\secret.key','.next-desktop\crm.sqlite3-wal','node\private.pfx')) {
    $dir = Fixture ('retain-' + [guid]::NewGuid().ToString('N'))
    $candidate = "$dir\app\$relative"
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($candidate)) | Out-Null
    [IO.File]::WriteAllText($candidate, 'SYNTHETIC-RETAIN')
    $calls = $global:CrmSyntheticCleanupTestState.shutdownCalls
    Reject $dir 'UPGRADE_POSSIBLE_USER_DATA'
    Check (([IO.File]::ReadAllText($candidate) -eq 'SYNTHETIC-RETAIN') -and
      (Test-Path -LiteralPath "$dir\app\package-lock.json") -and
      $global:CrmSyntheticCleanupTestState.shutdownCalls -eq $calls) "retain-before-shutdown:$relative"
  }
  $dir = Fixture 'known-program-assets'
  $legacySpec = ([string][char]0x422) + ([string][char]0x417) + '.md'
  foreach ($relative in @('package-lock.json',$legacySpec,'templates\examples\client.yaml','templates\examples\client.md',
      'templates\examples\collection.docx','templates\examples\collection.xlsx','templates\examples\collection.yaml',
      'templates\examples\registry.yaml','templates\examples\create-examples.ts','templates\obsolete-ci-example.txt',
      'prisma\sqlite\migrations\001_test\migration.sql','prisma\sqlite\constraints.sql',
      'node_modules\demo\asset.png','.next-desktop\static\asset.pdf','chromium\runtime.zip','node\notice.doc')) {
    $target = "$dir\app\$relative"
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
    [IO.File]::WriteAllText($target, 'SYNTHETIC-PROGRAM')
    [IO.File]::SetAttributes($target, [IO.FileAttributes]::ReadOnly)
  }
  [IO.File]::SetAttributes("$dir\app\templates\examples", [IO.FileAttributes]::ReadOnly)
  [IO.File]::SetAttributes("$dir\app", [IO.FileAttributes]::ReadOnly)
  & $helper -InstallDirectory $dir -InstallerPath "$root\setup.exe"
  Check (-not (Test-Path -LiteralPath "$dir\app")) 'known-legacy-runtime-and-readonly-cleaned'
  foreach ($name in @('crm.db','crm.sqlite3-wal','.env','clouds.env','customerdata','secret.key')) {
    $dir = Fixture ('guard-' + [guid]::NewGuid().ToString('N'))
    Set-Content -LiteralPath "$dir\app\$name" -Value 'SYNTHETIC-NEVER-READ'
    Reject $dir 'UPGRADE_POSSIBLE_USER_DATA'
    Check (Test-Path -LiteralPath "$dir\app\package-lock.json") 'refusal-before-deletion'
  }
  $dir = Fixture 'files-guard'
  New-Item -ItemType Directory -Path "$dir\app\files" | Out-Null
  Reject $dir 'UPGRADE_POSSIBLE_USER_DATA'
  foreach ($extension in @('xls','xlsm','xlsb','csv','ods','doc','odt','rtf','jpeg','png','gif','webp','bmp','tif','tiff','heic','svg','ico','7z','rar','tar','gz','bak','sql')) {
    $dir = Fixture ('extension-' + $extension)
    [IO.File]::WriteAllText("$dir\app\user.$extension", 'SYNTHETIC-RETAIN')
    Reject $dir 'UPGRADE_POSSIBLE_USER_DATA'
    Check (Test-Path -LiteralPath "$dir\app\user.$extension") "retain-extension:$extension"
  }
  $dir = Fixture 'root-type-mismatch'
  [IO.File]::WriteAllText("$dir\app\public", 'SYNTHETIC-RETAIN')
  Reject $dir 'UPGRADE_POSSIBLE_USER_DATA'
  $dir = Fixture 'unproven'
  Remove-Item -LiteralPath "$dir\app\desktop-manifest.json"
  Reject $dir 'UPGRADE_OWNERSHIP_UNPROVEN'
  $dir = Fixture 'installer-in-app'
  Reject $dir 'UPGRADE_INSTALLER_IN_RESOURCE_TREE' "$dir\app\new-setup.exe"
  $dir = Fixture 'query-fails'
  $global:CrmSyntheticCleanupTestState.running = $true
  Reject $dir 'TEST_PROCESS_QUERY_FAILURE'
  $global:CrmSyntheticCleanupTestState.running = $false
  Check (Test-Path -LiteralPath "$dir\app\package-lock.json") 'process-check-fails-closed'
  $global:CrmSyntheticCleanupTestState.shutdownCode = 1
  Reject $dir 'UPGRADE_SHUTDOWN_FAILED'
  $global:CrmSyntheticCleanupTestState.shutdownCode = 0
  Check (Test-Path -LiteralPath "$dir\app\package-lock.json") 'shutdown-fails-closed'
  $global:CrmSyntheticCleanupTestState.spawnFails = $true
  Reject $dir 'UPGRADE_SHUTDOWN_FAILED'
  $global:CrmSyntheticCleanupTestState.spawnFails = $false
  Check (Test-Path -LiteralPath "$dir\app\package-lock.json") 'spawn-fails-closed'
  $dir = Fixture 'process-descendants'
  # Reverse order forces transitive closure; shared executable alone is not owned.
  $global:CrmSyntheticCleanupTestState.processes = @(
    [pscustomobject]@{ ProcessId = 103; ParentProcessId = 102; ExecutablePath = 'C:\Shared\WebView.exe' },
    [pscustomobject]@{ ProcessId = 102; ParentProcessId = 101; ExecutablePath = 'C:\Shared\WebView.exe' },
    [pscustomobject]@{ ProcessId = 101; ParentProcessId = 1; ExecutablePath = "$dir\RealEstateCRM.exe" },
    [pscustomobject]@{ ProcessId = 200; ParentProcessId = 1; ExecutablePath = 'C:\Shared\WebView.exe' })
  # Observe OwnedProcesses inside helper scope without touching real processes.
  $global:CrmSyntheticCleanupTestState.afterShutdown = {
    $ids = @(OwnedProcesses | ForEach-Object { $_.ProcessId })
    Check (($ids.Count -eq 3) -and (103 -in $ids) -and (200 -notin $ids)) 'direct-ancestry-transitive-only'
  }
  & $helper -InstallDirectory $dir -InstallerPath "$root\setup.exe"
  $global:CrmSyntheticCleanupTestState.afterShutdown = $null
  Check ($global:CrmSyntheticCleanupTestState.sleeps -eq 1) 'owned-processes-wait-not-killed'
  $dir = Fixture 'late-user-data'
  $global:CrmSyntheticCleanupTestState.afterShutdown = { [IO.File]::WriteAllText("$dir\app\late.xlsx", 'SYNTHETIC-LATE') }
  Reject $dir 'UPGRADE_POSSIBLE_USER_DATA'
  $global:CrmSyntheticCleanupTestState.afterShutdown = $null
  Check (Test-Path -LiteralPath "$dir\app\package-lock.json") 'second-inventory-before-delete'
  foreach ($bad in @('relative','C:\','C:\safe\..\unsafe','\\server\share','C:\safe:stream','C:\safe.\app','C:\safe\*')) {
    Reject $bad 'UPGRADE_PATH_INVALID'
  }
  $dir = Fixture 'junction'
  $link = "$dir\app\linked"
  New-Item -ItemType Junction -Path $link -Target "$root\external" | Out-Null
  Reject $dir 'UPGRADE_REPARSE_POINT'
  # Remove the junction itself, never recurse through its target.
  [IO.Directory]::Delete($link)
  $ancestor = Join-Path $root 'ancestor-link'
  New-Item -ItemType Junction -Path $ancestor -Target $dir | Out-Null
  Reject $ancestor 'UPGRADE_REPARSE_POINT'
  [IO.Directory]::Delete($ancestor)
  $dir = Fixture 'app-root-link'
  [IO.Directory]::Move("$dir\app", "$dir\saved-app")
  New-Item -ItemType Junction -Path "$dir\app" -Target "$root\external" | Out-Null
  Reject $dir 'UPGRADE_REPARSE_POINT'
  [IO.Directory]::Delete("$dir\app")
  New-Item -ItemType Junction -Path "$root\installer-link" -Target "$root\external" | Out-Null
  Reject $dir 'UPGRADE_REPARSE_POINT' "$root\installer-link\setup.exe"
  [IO.Directory]::Delete("$root\installer-link")
  Check ((Get-Content -LiteralPath "$root\external\files\control.txt") -eq 'SYNTHETIC-CONTROL') 'junction-target-retained'
  $dir = Fixture 'late-junction'
  $global:CrmSyntheticCleanupTestState.afterShutdown = {
    New-Item -ItemType Junction -Path "$dir\app\node_modules" -Target "$root\external" | Out-Null
  }
  Reject $dir 'UPGRADE_REPARSE_POINT'
  $global:CrmSyntheticCleanupTestState.afterShutdown = $null
  [IO.Directory]::Delete("$dir\app\node_modules")
  Check (Test-Path -LiteralPath "$dir\app\package-lock.json") 'late-junction-before-delete'
  # Full-helper timings include both inventories, native deletes and fake shutdown.
  # 1200 depth-11 files: 15s is deliberately generous for loaded CI hosts, while
  # the reviewed old algorithm extrapolates to ~58s on the same file count.
  foreach ($run in 1..2) {
    $dir = Fixture "performance-$run"
    $deep = "$dir\app\node_modules\a\b\c\d\e\f\g\h\i\j"
    [IO.Directory]::CreateDirectory($deep) | Out-Null
    foreach ($i in 1..1200) { [IO.File]::WriteAllText("$deep\asset-$i.js", 'SYNTHETIC') }
    $watch = [Diagnostics.Stopwatch]::StartNew()
    & $helper -InstallDirectory $dir -InstallerPath "$root\setup.exe"
    $watch.Stop()
    Write-Output "MEASURE deep-cleanup run=$run files=1200 depth=11 elapsedMs=$($watch.ElapsedMilliseconds) budgetMs=15000"
    Check ($watch.ElapsedMilliseconds -lt 15000 -and -not (Test-Path -LiteralPath "$dir\app")) 'deep-performance-budget'
  }
  Write-Output 'PASS synthetic-upgrade-resource-cleanup-complete'
} finally {
  # This UUID tree was created exclusively by this test. Reject links before cleanup.
  $links = @(Get-ChildItem -LiteralPath $root -Force -Recurse | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
  foreach ($link in $links) { [IO.Directory]::Delete($link.FullName) }
  Remove-Item -LiteralPath $root -Recurse -Force
  Remove-Variable -Name CrmSyntheticCleanupTestState -Scope Global
}
