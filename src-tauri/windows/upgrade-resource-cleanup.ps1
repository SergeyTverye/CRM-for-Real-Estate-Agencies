param(
  [Parameter(Mandatory)][string]$InstallDirectory,
  [Parameter(Mandatory)][string]$InstallerPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function AbsolutePath([string]$value) {
  # No relative, UNC/device, ADS, wildcard, dot-segment or ambiguous Win32 paths.
  if ($value -notmatch '^[A-Za-z]:\\' -or $value.Substring(2).Contains(':') -or
      $value -match '[/*?"<>|]' -or $value -match '\\(?:\.{1,2})(?:\\|$)' -or
      $value -match '[. ](?:\\|$)') { throw 'UPGRADE_PATH_INVALID' }
  $full = [IO.Path]::GetFullPath($value).TrimEnd('\')
  if ($full.Length -le 3) { throw 'UPGRADE_PATH_INVALID' }
  return $full
}
function NoLink([string]$path) {
  $current = $path
  while ($current) {
    try { $attributes = [IO.File]::GetAttributes($current) }
    catch [IO.FileNotFoundException] { $attributes = 0 }
    catch [IO.DirectoryNotFoundException] { $attributes = 0 }
    if ($attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'UPGRADE_REPARSE_POINT' }
    $current = [IO.Path]::GetDirectoryName($current)
  }
}
$installation = AbsolutePath $InstallDirectory
$installer = AbsolutePath $InstallerPath
NoLink $installation
NoLink $installer
$app = "$installation\app"
if ($installer.Equals($app,[StringComparison]::OrdinalIgnoreCase) -or
    $installer.StartsWith("$app\",[StringComparison]::OrdinalIgnoreCase)) { throw 'UPGRADE_INSTALLER_IN_RESOURCE_TREE' }
try { $appAttributes = [IO.File]::GetAttributes($app) }
catch [IO.FileNotFoundException] { Write-Output 'UPGRADE_NO_OLD_RESOURCES'; exit 0 }
catch [IO.DirectoryNotFoundException] { Write-Output 'UPGRADE_NO_OLD_RESOURCES'; exit 0 }
if ($appAttributes -band [IO.FileAttributes]::ReparsePoint) { throw 'UPGRADE_REPARSE_POINT' }
if (-not ($appAttributes -band [IO.FileAttributes]::Directory)) { throw 'UPGRADE_RESOURCE_NOT_DIRECTORY' }

function InApp([string]$path) {
  $full = AbsolutePath $path
  if (-not $full.StartsWith("$app\",[StringComparison]::OrdinalIgnoreCase)) { throw 'UPGRADE_SCOPE_INVALID' }
  return $full
}
# Enumerate one level at a time, rejecting links BEFORE traversing them. Do not
# read candidate data/secret contents, even when refusing a legacy installation.
function CheckedAttributes([string]$path) {
  $attributes = [IO.File]::GetAttributes($path)
  if ($attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'UPGRADE_REPARSE_POINT' }
  return $attributes
}
function Inventory([string]$directory) {
  $null = CheckedAttributes $directory
  foreach ($path in [IO.Directory]::EnumerateFileSystemEntries($directory)) {
    $full = InApp $path
    $attributes = CheckedAttributes $full
    $isDirectory = [bool]($attributes -band [IO.FileAttributes]::Directory)
    $name = [IO.Path]::GetFileName($full)
    $relative = $full.Substring($app.Length + 1)
    if ($name -match '^(?:\.env(?:\..*)?|clouds\.env|private-data|private-imports|customerdata|userdata|PG_VERSION)$' -or
        $name -match '\.(?:db|sqlite|sqlite3|crmbackup|dump)(?:-(?:wal|shm|journal))?$|\.(?:pem|key|pfx|p12|kdbx)$' -or
        $relative -match '^(?:data|files|backups|config|secrets|logs|uploads|storage|profiles?)(?:\\|$)') {
      throw 'UPGRADE_POSSIBLE_USER_DATA'
    }
    $rootName = $relative.Split('\')[0]
    if ($relative -notmatch '\\') {
      $known = if ($isDirectory) {
        $name -in @('.next-desktop','chromium','generated','import-profiles','node','node_modules','prisma','public','templates','workers')
      } else {
        $name -in @('backup-command.cjs','backup-now.cjs','desktop-manifest.json','graceful.cjs','init-db.cjs','package.json','RUNTIMES.md','sbom.cdx.json','server.js','supervisor.mjs','upgrade.cjs','package-lock.json') -or
          $name -match '^(?:tz|\u0422\u0417)(?:[_. -].*)?\.md$'
      }
      if (-not $known) { throw 'UPGRADE_POSSIBLE_USER_DATA' }
    }
    # Source policy has no public assets. Sole exception is the exact zero-byte
    # developer placeholder public\.gitkeep left by legacy scaffolding (length 0,
    # regular file, metadata size only). Nonempty .gitkeep and any other public
    # entry remain user-data suspects. Reparse/scope checks above stay first.
    if ($rootName -eq 'public' -and $relative -ne 'public') {
      $isLegacyPlaceholder = ((-not $isDirectory) -and ($relative -eq 'public\.gitkeep'))
      if ($isLegacyPlaceholder) {
        try { $placeholderLength = (New-Object IO.FileInfo($full)).Length }
        catch { throw 'UPGRADE_POSSIBLE_USER_DATA' }
        if ($placeholderLength -ne 0) { throw 'UPGRADE_POSSIBLE_USER_DATA' }
      } else {
        throw 'UPGRADE_POSSIBLE_USER_DATA'
      }
    }
    if ($rootName -eq 'templates' -and $relative -ne 'templates') {
      $knownTemplate = if ($isDirectory) { $relative -eq 'templates\examples' } else {
        $relative -match '^templates\\examples\\(?:client\.yaml|client\.md|collection\.docx|collection\.xlsx|collection\.yaml|registry\.yaml|create-examples\.ts)$' -or
          $relative -in @('templates\obsolete.txt','templates\obsolete-ci-example.txt')
      }
      if (-not $knownTemplate) { throw 'UPGRADE_POSSIBLE_USER_DATA' }
    }
    if (-not $isDirectory -and $rootName -notin @('node_modules','.next-desktop','chromium','node') -and
        $name -match '\.(?:xlsx?|xlsm|xlsb|csv|ods|docx?|odt|rtf|pdf|jpe?g|png|gif|webp|bmp|tiff?|heic|svg|ico|zip|7z|rar|tar|gz|bak|sql)$' -and
        $relative -notmatch '^templates\\examples\\collection\.(?:xlsx|docx)$' -and
        $relative -notmatch '^prisma\\sqlite\\(?:constraints\.sql|migrations\\[^\\]+\\migration\.sql)$') {
      throw 'UPGRADE_POSSIBLE_USER_DATA'
    }
    $children = @()
    if ($isDirectory) { $children = @(Inventory $full) }
    [pscustomobject]@{ FullName = $full; IsDirectory = $isDirectory; Children = @($children) }
  }
}
NoLink $app
$items = @(Inventory $app)
# Existing launcher AND fixed runtime markers identify this exact app tree.
foreach ($marker in @('RealEstateCRM.exe','app\desktop-manifest.json','app\supervisor.mjs','app\node\node.exe')) {
  $target = "$installation\$marker"
  NoLink $target
  try { $markerAttributes = [IO.File]::GetAttributes($target) }
  catch { throw 'UPGRADE_OWNERSHIP_UNPROVEN' }
  if ($markerAttributes -band [IO.FileAttributes]::Directory) { throw 'UPGRADE_OWNERSHIP_UNPROVEN' }
}
$manifest = Get-Content -LiteralPath "$app\desktop-manifest.json" -Raw | ConvertFrom-Json
if (-not $manifest.version -or -not $manifest.node -or $manifest.initEntry -ne 'scripts/desktop/init-db.ts' -or
    $manifest.backupEntry -ne 'scripts/desktop/runtime/backup-worker.ts') { throw 'UPGRADE_OWNERSHIP_UNPROVEN' }

# Only this installation's launcher is invoked. Never stop unrelated processes,
# force-kill, purge a profile, or invoke an old uninstaller here.
function OwnedProcesses {
  $all = @(Get-CimInstance Win32_Process)
  $owned = @{}
  foreach ($process in $all) {
    if ($process.ExecutablePath -and ($process.ExecutablePath.Equals("$installation\RealEstateCRM.exe",[StringComparison]::OrdinalIgnoreCase) -or
        $process.ExecutablePath.StartsWith("$app\",[StringComparison]::OrdinalIgnoreCase))) { $owned[[int]$process.ProcessId] = $true }
  }
  do {
    $added = $false
    foreach ($process in $all) {
      if ($owned.ContainsKey([int]$process.ParentProcessId) -and -not $owned.ContainsKey([int]$process.ProcessId)) {
        $owned[[int]$process.ProcessId] = $true; $added = $true
      }
    }
  } while ($added)
  @($all | Where-Object { $owned.ContainsKey([int]$_.ProcessId) })
}
try { $shutdown = Start-Process -FilePath "$installation\RealEstateCRM.exe" -ArgumentList '--shutdown' -PassThru -WindowStyle Hidden -WorkingDirectory $installation }
catch { throw 'UPGRADE_SHUTDOWN_FAILED' }
if (-not $shutdown.WaitForExit(200000) -or $shutdown.ExitCode -ne 0) { throw 'UPGRADE_SHUTDOWN_FAILED' }
$deadline = (Get-Date).AddSeconds(185)
while (@(OwnedProcesses).Count -gt 0) {
  if ((Get-Date) -ge $deadline) { throw 'UPGRADE_PROCESSES_REMAIN' }
  Start-Sleep -Milliseconds 250
}
# Revalidate the complete inventory before the first deletion. Individual,
# literal, nonrecursive removals also fail closed if a directory gains children.
$items = @(Inventory $app)
function DeleteCheckedChildren([string]$directory, $children) {
  foreach ($item in $children) {
    # Recheck active parent and target, not cached FileInfo attrs. Parents were
    # checked top-down; this is not fencing against hostile same-user races.
    $parentAttributes = CheckedAttributes $directory
    if (-not ($parentAttributes -band [IO.FileAttributes]::Directory)) { throw 'UPGRADE_SCOPE_INVALID' }
    $target = InApp $item.FullName
    $attributes = CheckedAttributes $target
    if ([bool]($attributes -band [IO.FileAttributes]::Directory) -ne $item.IsDirectory) { throw 'UPGRADE_SCOPE_INVALID' }
    if ($item.IsDirectory) { DeleteCheckedChildren $target $item.Children }
    $null = CheckedAttributes $directory
    $attributes = CheckedAttributes $target
    if ([bool]($attributes -band [IO.FileAttributes]::Directory) -ne $item.IsDirectory) { throw 'UPGRADE_SCOPE_INVALID' }
    if ($attributes -band [IO.FileAttributes]::ReadOnly) {
      [IO.File]::SetAttributes($target, ($attributes -bxor [IO.FileAttributes]::ReadOnly))
    }
    if ($item.IsDirectory) { [IO.Directory]::Delete($target, $false) }
    else { [IO.File]::Delete($target) }
  }
}
NoLink $installation
NoLink $app
DeleteCheckedChildren $app $items
NoLink $app
$attributes = CheckedAttributes $app
if ($attributes -band [IO.FileAttributes]::ReadOnly) { [IO.File]::SetAttributes($app, ($attributes -bxor [IO.FileAttributes]::ReadOnly)) }
[IO.Directory]::Delete($app, $false)
Write-Output 'UPGRADE_PROGRAM_RESOURCES_CLEANED'
