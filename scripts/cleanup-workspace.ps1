[CmdletBinding()]
param([switch]$Execute)

# No content reads, Git mutations, process termination, or recursive Remove-Item.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent)).TrimEnd('\')
$comparison = [StringComparison]::OrdinalIgnoreCase
$protected = @('.git','node_modules','prisma','generated','import-profiles','importprofiles',
    'vendor','Real-Estate-Scrapper','backups','data','private-data','secrets','keys',
    'source','docs','screenshots','specs','desktop-artifacts')
$results = [Collections.Generic.List[object]]::new()
$plans = [Collections.Generic.List[object]]::new()

function Assert-PlainPath([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    if (-not $full.StartsWith($root + '\', $comparison)) { throw 'OUTSIDE_WORKSPACE' }
    $cursor = $full
    while ($cursor) {
        # Native metadata lookup avoids repeated PowerShell provider enumeration.
        # A missing or inaccessible ancestor fails closed.
        if ([IO.File]::GetAttributes($cursor) -band [IO.FileAttributes]::ReparsePoint) { throw 'REPARSE_POINT' }
        $parent = [IO.Directory]::GetParent($cursor)
        $cursor = if ($parent) { $parent.FullName } else { $null }
    }
    return $full
}

function Assert-Allowed([string]$Path) {
    $full = Assert-PlainPath $Path
    $rel = $full.Substring($root.Length + 1).Replace('\','/')
    $allowed = ($rel -notmatch '/' -and ($rel -like '*.log' -or $rel -like '*.tsbuildinfo')) -or
        ($rel -match '^\.next-[^/]+$') -or
        $rel -in @('test-results','playwright-report','coverage','src-tauri/target','src-tauri/resources/node-download')
    if (-not $allowed) { throw 'NOT_ALLOWLISTED' }
    return $rel
}

function Assert-GitSafe([string]$Relative, [bool]$Directory) {
    $tracked = @(& git -C $root ls-files -- $Relative 2>$null)
    if ($LASTEXITCODE -ne 0) { throw 'GIT_CHECK_FAILED' }
    if ($tracked.Count) { throw 'TRACKED_CONTENT' }
    $ignorePath = if ($Directory) { $Relative + '/' } else { $Relative }
    & git -C $root check-ignore --quiet -- $ignorePath 2>$null
    if ($LASTEXITCODE -eq 1) { throw 'CANDIDATE_NOT_IGNORED' }
    if ($LASTEXITCODE -ne 0) { throw 'GIT_CHECK_FAILED' }
}

function Get-ProcessSnapshot {
    # CommandLine is inspected in memory only; never output or saved.
    return @(Get-CimInstance Win32_Process -ErrorAction Stop |
        Select-Object ProcessId,Name,ExecutablePath,CommandLine)
}

function Assert-Inactive([string]$Path, [string]$Relative, $Processes) {
    foreach ($p in $Processes) {
        if ($p.ProcessId -eq $PID) { continue }
        $cmd = [string]$p.CommandLine
        $exe = [string]$p.ExecutablePath
        if (-not $exe -and -not (Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue)) { continue }
        # Coordinator/helper command text may quote this task and candidate names.
        # Only known external agent runtimes with no build/test entrypoint qualify.
        $agentRuntime = $exe -match '(?i)[\\/](codex|opencodex)[\\/]|[\\/]codex-runtimes[\\/]|[\\/]@bitkyc08[\\/]opencodex[\\/]'
        $buildEntrypoint = $cmd -match '(?i)(?:[\\/](?:next|vitest|playwright)[\\/]|\b(?:next|vitest|playwright|cargo|rustc)\s+(?:dev|start|build|test|run)\b)'
        if ($agentRuntime -and -not $buildEntrypoint) { continue }
        if ($exe.StartsWith($Path + '\', $comparison) -or $exe.Equals($Path, $comparison) -or
            $cmd.IndexOf($Path, $comparison) -ge 0 -or
            $cmd.IndexOf($Relative, $comparison) -ge 0 -or
            $cmd.IndexOf($Relative.Replace('/','\'), $comparison) -ge 0) { throw 'ACTIVE_PROCESS_REFERENCE' }
        $runtime = $p.Name -match '^(node|npm|npx|bun|deno|playwright|cargo|rustc|rustup)(\.exe)?$'
        if (-not $runtime) { continue }
        $repoReference = $exe.StartsWith($root + '\', $comparison) -or
            $cmd.IndexOf($root, $comparison) -ge 0 -or
            $cmd.IndexOf($root.Replace('\','/'), $comparison) -ge 0
        if ($repoReference) { throw 'ACTIVE_REPO_BUILD_OR_TEST_PROCESS' }
        # An external executable alone is insufficient: require explicit helper identity too.
        $externalHelper = [IO.Path]::IsPathRooted($exe) -and
            -not $exe.StartsWith($root + '\', $comparison) -and
            ($exe -match '(?i)codex|opencode|opencodex|mcp' -or
             $cmd -match '(?i)codex|opencode|opencodex|mcp')
        # Installed desktop runtime has its own files outside this checkout.
        $installedApp = Join-Path $env:LOCALAPPDATA 'Programs\RealEstateCRM\app'
        if ($exe.StartsWith($installedApp + '\', $comparison) -and
            $cmd.IndexOf($installedApp + '\', $comparison) -ge 0) { $externalHelper = $true }
        if (-not $externalHelper) { throw 'ACTIVE_BUILD_PROCESS_AMBIGUOUS_CWD' }
    }
}

function Get-SafeInventory([string]$Path) {
    $files = [Collections.Generic.List[object]]::new()
    $dirs = [Collections.Generic.List[string]]::new()
    $retained = [Collections.Generic.List[string]]::new()
    $pending = [Collections.Generic.Stack[string]]::new()
    $pending.Push($Path)
    while ($pending.Count) {
        $current = $pending.Pop()
        $null = Assert-PlainPath $current
        $item = Get-Item -LiteralPath $current -Force
        if ($item.Name -in $protected -or $item.Name -like '.env*' -or $item.Name -eq 'clouds.env' -or
            $item.Extension -in @('.xls','.xlsx','.xlsm','.pem','.key')) {
            $retained.Add($current)
            continue # Keep protected descendants and their ancestors; do not inspect contents.
        }
        if ($item.PSIsContainer) {
            $dirs.Add($current)
            foreach ($child in Get-ChildItem -LiteralPath $current -Force) { $pending.Push($child.FullName) }
        } else {
            # Check open handles without reading content; deny simultaneous opens during check.
            try {
                $handle = [IO.File]::Open($current, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
                $handle.Dispose()
            } catch { throw 'FILE_BUSY_OR_INACCESSIBLE' }
            $files.Add([pscustomobject]@{ Path=$current; Bytes=[long]$item.Length; Stamp=$item.LastWriteTimeUtc.Ticks })
        }
    }
    $inventoryBytes = 0L
    foreach ($entry in $files) { $inventoryBytes += $entry.Bytes }
    return [pscustomobject]@{ Files=$files; Dirs=$dirs; Retained=$retained; Bytes=$inventoryBytes }
}

function Error-Code($Record) {
    $message = $Record.Exception.Message
    if ($message -match '^[A-Z_]+$') { return $message }
    return 'IO_OR_ACCESS_ERROR'
}

$top = @(& git -C $root rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or $top.Count -ne 1 -or
    -not ([IO.Path]::GetFullPath($top[0])).Equals($root,$comparison)) { throw 'WORKSPACE_NOT_GIT_ROOT' }
$null = Assert-PlainPath (Join-Path $root 'scripts')
$processes = Get-ProcessSnapshot
$candidates = @(Get-ChildItem -LiteralPath $root -Force | Where-Object {
    (-not $_.PSIsContainer -and ($_.Name -like '*.log' -or $_.Name -like '*.tsbuildinfo')) -or
    ($_.PSIsContainer -and $_.Name -like '.next-*') -or
    ($_.PSIsContainer -and $_.Name -in @('test-results','playwright-report','coverage'))
} | ForEach-Object FullName)
foreach ($rel in @('src-tauri/target','src-tauri/resources/node-download')) {
    $path = Join-Path $root $rel
    if (Test-Path -LiteralPath $path) { $candidates += $path }
}

foreach ($path in $candidates) {
    $rel = $path.Substring($root.Length + 1).Replace('\','/')
    try {
        $rel = Assert-Allowed $path
        $isDir = (Get-Item -LiteralPath $path -Force).PSIsContainer
        Assert-GitSafe $rel $isDir
        Assert-Inactive $path $rel $processes
        $inventory = Get-SafeInventory $path
        $plans.Add([pscustomobject]@{ Path=$path; Relative=$rel; Directory=$isDir; Inventory=$inventory })
    } catch {
        $results.Add([pscustomobject]@{ Path=$rel; Code=(Error-Code $_); Files=0; Bytes=0L })
    }
}

$preFiles = 0L; $preBytes = 0L
foreach ($plan in $plans) { $preFiles += $plan.Inventory.Files.Count; $preBytes += $plan.Inventory.Bytes }
Write-Output "Preflight: targets=$($plans.Count), files=$preFiles, bytes=$preBytes, refused=$($results.Count), execute=$Execute"
foreach ($plan in $plans) {
    $removedFiles = 0L
    $removedBytes = 0L
    try {
        if (-not $Execute) { $code = 'DRY_RUN' } else {
            $null = Assert-Allowed $plan.Path
            Assert-GitSafe $plan.Relative $plan.Directory
            Assert-Inactive $plan.Path $plan.Relative (Get-ProcessSnapshot)
            $fresh = Get-SafeInventory $plan.Path
            if ($fresh.Files.Count -ne $plan.Inventory.Files.Count -or $fresh.Dirs.Count -ne $plan.Inventory.Dirs.Count -or
                $fresh.Retained.Count -ne $plan.Inventory.Retained.Count) { throw 'TREE_CHANGED' }
            $original = @{}
            foreach ($file in $plan.Inventory.Files) { $original[$file.Path] = $file }
            foreach ($file in $fresh.Files) {
                if (-not $original.ContainsKey($file.Path) -or $original[$file.Path].Bytes -ne $file.Bytes -or
                    $original[$file.Path].Stamp -ne $file.Stamp) { throw 'TREE_CHANGED' }
            }
            foreach ($file in $fresh.Files) {
                $null = Assert-PlainPath $file.Path
                $now = Get-Item -LiteralPath $file.Path -Force
                if ($now.Length -ne $file.Bytes -or $now.LastWriteTimeUtc.Ticks -ne $file.Stamp) { throw 'TREE_CHANGED' }
                Remove-Item -LiteralPath $file.Path -Force -ErrorAction Stop
                $removedFiles++
                $removedBytes += $file.Bytes
            }
            foreach ($dir in ($fresh.Dirs | Sort-Object Length -Descending)) {
                $null = Assert-PlainPath $dir
                $hasProtectedChild = $false
                foreach ($kept in $fresh.Retained) {
                    if ($kept.StartsWith($dir + '\', $comparison)) { $hasProtectedChild = $true; break }
                }
                if ($hasProtectedChild) { continue }
                [IO.Directory]::Delete($dir, $false) # Refuses unexpected new children; never follows links.
            }
            $code = if ($fresh.Retained.Count) { 'CLEANED_PROTECTED_REMAINDER' } else { 'DELETED' }
        }
        $results.Add([pscustomobject]@{ Path=$plan.Relative; Code=$code; Files=$removedFiles; Bytes=$removedBytes })
    } catch {
        $results.Add([pscustomobject]@{ Path=$plan.Relative; Code=(Error-Code $_); Files=$removedFiles; Bytes=$removedBytes })
    }
}

$deletedFiles = 0L; $deletedBytes = 0L
foreach ($result in $results) { $deletedFiles += $result.Files; $deletedBytes += $result.Bytes }
$failures = @($results | Where-Object Code -notin @('DELETED','DRY_RUN','CLEANED_PROTECTED_REMAINDER'))
$lines = [Collections.Generic.List[string]]::new()
$lines.Add('# Workspace cleanup')
$lines.Add('')
$lines.Add("UTC: $([DateTime]::UtcNow.ToString('o')); execute: $Execute; workspace: $root")
$lines.Add("Preflight: $($plans.Count) eligible targets; $preFiles files; $preBytes bytes.")
$lines.Add("Actually deleted: $deletedFiles files; $deletedBytes bytes; refused/failed targets: $($failures.Count).")
$lines.Add('Counts cover this invocation only. Earlier cleanup evidence is recorded in docs/progress-log.md.')
$lines.Add('')
$lines.Add('Preserved by policy (not recursively scanned): .next; desktop-artifacts/release; source, documentation, screenshots, specifications, Git, dependencies, Prisma/generated, import profiles, vendor, Real-Estate-Scrapper, backups, data, private-data, secrets, environment files and keys.')
$lines.Add('No file content or process command lines recorded. No processes stopped. Git queried only for candidate paths. Byte counts are logical file lengths, not physical disk allocation.')
$lines.Add('')
$lines.Add('## Outcome groups')
foreach ($group in ($results | Group-Object Code)) {
    $lines.Add("- $($group.Name): $($group.Count) targets; $([long](($group.Group | Measure-Object Bytes -Sum).Sum)) bytes removed.")
}
if ($failures.Count) {
    $lines.Add('')
    $lines.Add('## Per-path refusal/failure codes')
    foreach ($failure in $failures) { $lines.Add("- $($failure.Path): $($failure.Code)") }
}
$lines.Add('')
$lines.Add('## Directory outcomes')
foreach ($result in ($results | Where-Object { $_.Path -notmatch '^[^/]+\.(log|tsbuildinfo)$' })) {
    $lines.Add("- $($result.Path): $($result.Code); files removed=$($result.Files); bytes removed=$($result.Bytes)")
}
$lines.Add('')
$lines.Add('Reuse: `powershell -NoProfile -File scripts/cleanup-workspace.ps1` (dry-run); add `-Execute` to delete. Reports reflect the latest run.')
$lines.Add('Safety: exact allowlist; canonical workspace containment; inspected ancestors/descendants checked for reparse points; tracked content refused; directories must be ignored; protected descendant subtrees and their ancestors retained without content inspection; candidate/repository process references and ambiguous runtimes refused; explicitly identified external Codex/OpenCode/MCP helpers and installed RealEstateCRM runtime ignored; exclusive file-open probe; inventory rechecked before deletion. No recursive deletion. Concurrent filesystem changes cannot be fully fenced: do not run alongside artifact writers. Partial removals are counted on failure.')

# Dry-run must not replace evidence of an earlier executed cleanup.
if (-not $Execute) { $lines | Write-Output; exit 0 }
# Fixed workspace-only metadata report; refuse reparse points on ancestors too.
foreach ($destination in @((Join-Path $root 'docs/operations/workspace-cleanup.md'))) {
    $cursor = $destination
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'REPORT_REPARSE_POINT' }
        }
        $cursor = Split-Path $cursor -Parent
    }
    $parent = Split-Path $destination -Parent
    if (-not (Test-Path -LiteralPath $parent)) { $null = New-Item -ItemType Directory -Path $parent }
    [IO.File]::WriteAllLines($destination, $lines, [Text.UTF8Encoding]::new($false))
}
Write-Output "Result: deleted_files=$deletedFiles, deleted_bytes=$deletedBytes, refused_or_failed=$($failures.Count). Report: docs/operations/workspace-cleanup.md"
