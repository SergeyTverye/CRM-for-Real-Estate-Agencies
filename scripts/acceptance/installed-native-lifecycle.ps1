[CmdletBinding()]
param(
    [switch]$ExecuteInstalledNative, [string]$Launcher,
    [string]$InstalledShortcut, [string]$InstalledShortcutSha256,
    [string]$SystemDirectory = 'C:\Windows',
    [switch]$WaitForController, [ValidateRange(10,120)][int]$ControllerSeconds = 90
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = $VerbosePreference = $DebugPreference = $InformationPreference = 'SilentlyContinue'
$officialHash = '60bf5292982535763c2954bd84f9edb26437ad009d1250ad3bc49547a6b88524'
$script:publicScript = $PSCommandPath

function Get-SafeFailure([Management.Automation.ErrorRecord]$Record) {
    $known = @(
        'PATH_REJECTED','REPARSE_REJECTED','RESOURCE_MISSING','OTHER_CRM_REFUSED',
        'OTHER_WRITER_REFUSED','WRITE_SCOPE_REJECTED','READ_SCOPE_REJECTED','METADATA_REJECTED',
        'TOTAL_BOUND_EXPIRED','OWN_LAUNCHER_EXITED','SPAWN_IDENTITY_REJECTED',
        'LAUNCHER_HASH_REJECTED','SPAWN_FAILED','SPAWN_EXITED_EARLY','RUNTIME_URL_REJECTED',
        'RUNTIME_PID_REJECTED','SUPERVISOR_IDENTITY_REJECTED','CHILD_IDENTITY_REJECTED','CHILD_IMAGE_REJECTED','CHILD_START_REJECTED',
        'RUNTIME_IDENTITY_CHANGED','LOOPBACK_OWNER_REJECTED','FRESH_RUNTIME_REQUIRED',
        'API_CALL_FAILED','STOP_RUNTIME_UNVERIFIED','OWNED_EXIT_TIMEOUT','OWNED_CLEANUP_FAILED',
        'PLATFORM_REJECTED','INSTALLED_LAUNCHER_REJECTED','SHORTCUT_PROVENANCE_REJECTED',
        'SHORTCUT_TARGET_REJECTED','FIXTURE_EXISTS','ACL_REJECTED','READY_TIMEOUT',
        'FRESH_SETUP_REQUIRED','OWNED_WRITER_MUTEX_MISSING','SECOND_LAUNCH_RUNTIME_UNVERIFIED',
        'SECOND_LAUNCH_TIMEOUT','SINGLE_INSTANCE_FAILED','CONTROLLER_RUNTIME_LOST',
        'ACK_REJECTED','TASK_ID_REJECTED','REMINDER_TIMEOUT','RELAUNCH_TIMEOUT','PERSISTENCE_FAILED','CONDITION_RESULT_REJECTED'
    )
    $code = 'UNMAPPED_EXCEPTION'
    foreach ($candidate in $known) {
        if ([string]::Equals($Record.Exception.Message,$candidate,[StringComparison]::Ordinal)) { $code=$candidate; break }
    }
    $line = 0
    if ($Record.InvocationInfo.ScriptName -ceq $script:publicScript) {
        $line = [Math]::Max(0,$Record.InvocationInfo.ScriptLineNumber)
    }
    return @{failureCode=$code;exceptionType=$Record.Exception.GetType().FullName;publicScriptLine=$line}
}
function Write-SafeProgress([string]$Phase) {
    Write-Information -InformationAction Continue -MessageData (@{status='PROGRESS';phase=$Phase} | ConvertTo-Json -Compress)
}

function Assert-LocalPath([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value) -or $Value -notmatch '^[A-Za-z]:[\\/]' -or
        $Value -match '[\x00-\x1f<>"|?*]' -or $Value.Substring(2).Contains(':') -or
        $Value -match '(^|[\\/])\.\.?([\\/]|$)' -or
        ($Value -split '[\\/]' | Where-Object { $_ -match '[ .]$' })) { throw 'PATH_REJECTED' }
    $full = [IO.Path]::GetFullPath($Value).TrimEnd('\','/'); $cur = $full
    while ($cur) {
        if ((Test-Path -LiteralPath $cur) -and ((Get-Item -Force -LiteralPath $cur).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'REPARSE_REJECTED' }
        $parent = [IO.Directory]::GetParent($cur); if ($null -eq $parent) { break }; $cur = $parent.FullName
    }
    return $full
}
function Assert-Leaf([string]$Value) {
    $p = Assert-LocalPath $Value
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw 'RESOURCE_MISSING' }
    return $p
}
function Test-Contained([string]$Root, [string]$Target) {
    return (Assert-LocalPath $Target).StartsWith((Assert-LocalPath $Root) + '\', [StringComparison]::OrdinalIgnoreCase)
}
function Assert-NoOtherCrm {
    if (@(Get-Process -Name RealEstateCRM -ErrorAction SilentlyContinue).Count) { throw 'OTHER_CRM_REFUSED' }
    try { $m = [Threading.Mutex]::OpenExisting('Local\RealEstateCRM.Desktop.Writer'); $m.Dispose(); throw 'OTHER_WRITER_REFUSED' }
    catch [Threading.WaitHandleCannotBeOpenedException] { }
}
function Write-NewJson([string]$Name, $Value) {
    $target = Join-Path $script:runRoot $Name
    if (-not (Test-Contained $script:runRoot $target)) { throw 'WRITE_SCOPE_REJECTED' }
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Depth 8))
    $s = [IO.File]::Open((Assert-LocalPath $target), 'CreateNew', 'Write', 'None')
    try { $s.Write($bytes,0,$bytes.Length) } finally { $s.Dispose() }
}
function Read-OwnedJson([string]$File, [int]$Limit = 4096) {
    if (-not (Test-Contained $script:runRoot $File)) { throw 'READ_SCOPE_REJECTED' }
    $item = Get-Item -Force -LiteralPath (Assert-Leaf $File)
    if ($item.Length -le 0 -or $item.Length -gt $Limit -or @($item.LinkType | Where-Object { $_ }).Count) { throw 'METADATA_REJECTED' }
    try { return [IO.File]::ReadAllText($File) | ConvertFrom-Json } catch { throw 'METADATA_REJECTED' }
}
function Add-Check([string]$Code, [string]$Status) { $script:checks.Add(@{code=$Code;status=$Status}) }
function Assert-Bound {
    if ($script:clock.Elapsed.TotalSeconds -gt 600) { throw 'TOTAL_BOUND_EXPIRED' }
}
function New-CleanStartInfo {
    $psi = [Diagnostics.ProcessStartInfo]::new($script:exe)
    $psi.UseShellExecute = $false; $psi.WorkingDirectory = $script:installDir; $psi.CreateNoWindow = $false
    $psi.Environment.Clear() # Never enumerate/read inherited env, including debug/data secrets.
    $clean = @{
        SystemRoot=$script:system; WINDIR=$script:system; SystemDrive=$script:system.Substring(0,2)
        COMSPEC=(Join-Path $script:system 'System32\cmd.exe')
        PATH=((Join-Path $script:system 'System32') + ';' + (Join-Path $script:system 'System32\WindowsPowerShell\v1.0'))
        PATHEXT='.COM;.EXE;.BAT;.CMD'
        LOCALAPPDATA=$script:dirs.localappdata; APPDATA=$script:dirs.roaming
        TEMP=$script:dirs.temp; TMP=$script:dirs.temp; USERPROFILE=$script:dirs.home; HOME=$script:dirs.home
    }
    foreach ($k in $clean.Keys) { $psi.Environment[[string]$k] = [string]$clean[$k] }
    return ,$psi
}
function Get-ProcessStamp($p) {
    return ([datetime]$p.CreationDate).ToUniversalTime().Ticks.ToString()
}
function Assert-Spawn($Owned) {
    if ($null -eq $Owned -or $Owned.Process.HasExited) { throw 'OWN_LAUNCHER_EXITED' }
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($Owned.Process.Id)"
    if (-not $p -or $p.ParentProcessId -ne $PID -or $p.ExecutablePath -ine $script:exe -or
        (Get-ProcessStamp $p) -ne $Owned.Stamp) { throw 'SPAWN_IDENTITY_REJECTED' }
}
function Start-Owned([switch]$AllowEarlyExit) {
    Assert-Bound
    if ((Get-FileHash -LiteralPath (Assert-Leaf $script:exe) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $officialHash) { throw 'LAUNCHER_HASH_REJECTED' }
    $p = [Diagnostics.Process]::new(); $p.StartInfo = New-CleanStartInfo
    $o = @{Process=$p; Stamp=$null; Started=$false}; $script:spawns.Add($o)
    if (-not $p.Start()) { throw 'SPAWN_FAILED' }
    $o.Started = $true
    $null = $p.SafeHandle
    if ($p.HasExited) {
        if ($AllowEarlyExit) { return $o }; throw 'SPAWN_EXITED_EARLY'
    }
    try {
        $meta = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)"
        if ($AllowEarlyExit -and $p.HasExited) { return $o }
        if (-not $meta -or $meta.ParentProcessId -ne $PID -or $meta.ExecutablePath -ine $script:exe -or
            [Math]::Abs((([datetime]$meta.CreationDate).ToUniversalTime() - $p.StartTime.ToUniversalTime()).TotalMilliseconds) -gt 20) { throw 'SPAWN_IDENTITY_REJECTED' }
        $o.Stamp = Get-ProcessStamp $meta
        Assert-Spawn $o
    } catch {
        if ($AllowEarlyExit -and $p.HasExited) { return $o }
        throw
    }
    return $o
}
function Assert-OwnedRuntime {
    $script:runtimeProof = @{mismatch='CHECKING';runtimePresent=$false;serverUnique=$false;workerUnique=$false;listenerPresent=$false;verified=$false}
    $null = Assert-Bound; $null = Assert-Spawn $script:app
    $allowed = @($script:spawns | Where-Object { -not $_.Process.HasExited } | ForEach-Object { $_.Process.Id })
    if (@(Get-Process -Name RealEstateCRM -ErrorAction SilentlyContinue | Where-Object { $allowed -notcontains $_.Id }).Count) { throw 'OTHER_CRM_REFUSED' }
    if (-not (Test-Path -LiteralPath $script:runtimeJson)) { $script:runtimeProof.mismatch='MISSING_RUNTIME'; return $false }
    $script:runtimeProof.runtimePresent=$true
    $info = Read-OwnedJson $script:runtimeJson
    $urlMatch = [regex]::Match([string]$info.url,'\Ahttp://127\.0\.0\.1:([1-9][0-9]{0,4})\z')
    if (-not $urlMatch.Success -or [int]$urlMatch.Groups[1].Value -gt 65535) { throw 'RUNTIME_URL_REJECTED' }
    $portNumber = [int]$urlMatch.Groups[1].Value
    if ($info.pid -isnot [long] -and $info.pid -isnot [int]) { throw 'RUNTIME_PID_REJECTED' }
    if ($info.pid -lt 1) { throw 'RUNTIME_PID_REJECTED' }
    if ($script:retiredSupervisorPid -and $info.pid -eq $script:retiredSupervisorPid) { $script:runtimeProof.mismatch='RETIRED_RUNTIME_METADATA'; return $false }
    $sup = Get-CimInstance Win32_Process -Filter "ProcessId=$($info.pid)"
    if (-not $sup -or $sup.ParentProcessId -ne $script:app.Process.Id -or $sup.ExecutablePath -ine $script:nodeExe -or
        ([datetime]$sup.CreationDate).ToUniversalTime() -lt $script:app.Process.StartTime.ToUniversalTime()) { throw 'SUPERVISOR_IDENTITY_REJECTED' }
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($info.pid)")
    $server = @($children | Where-Object { $_.ExecutablePath -ieq $script:nodeExe -and $_.CommandLine.Contains($script:serverJs) })
    $worker = @($children | Where-Object { $_.ExecutablePath -ieq $script:nodeExe -and $_.CommandLine.Contains($script:notifWorker) })
    $script:runtimeProof.serverUnique=($server.Count -eq 1); $script:runtimeProof.workerUnique=($worker.Count -eq 1)
    if ($server.Count -ne 1) { $script:runtimeProof.mismatch='SERVER_MISSING_OR_AMBIGUOUS'; return $false }
    if ($worker.Count -ne 1) { $script:runtimeProof.mismatch='WORKER_MISSING_OR_AMBIGUOUS'; return $false }
    foreach ($p in @($sup) + $children) {
        $consoleHost=Join-Path $script:system 'System32\conhost.exe'
        if ($p.ExecutablePath -ine $script:nodeExe -and $p.ExecutablePath -ine $consoleHost) {
            $childName=[IO.Path]::GetFileName([string]$p.ExecutablePath).ToLowerInvariant()
            $script:childImageKind=if ($childName -in @('conhost.exe','powershell.exe','cmd.exe','icacls.exe')) {$childName} else {'OTHER'}
            throw 'CHILD_IMAGE_REJECTED'
        }
        if (([datetime]$p.CreationDate).ToUniversalTime() -lt ([datetime]$sup.CreationDate).ToUniversalTime()) { throw 'CHILD_START_REJECTED' }
        $key = [string]$p.ProcessId; $stamp = Get-ProcessStamp $p
        if ($script:runtimePins.ContainsKey($key) -and $script:runtimePins[$key] -ne $stamp) { throw 'RUNTIME_IDENTITY_CHANGED' }
        $script:runtimePins[$key] = $stamp
        $script:runtimeImages[$key] = [string]$p.ExecutablePath
    }
    if ($script:supervisorPid -and $script:supervisorPid -ne $info.pid) { throw 'RUNTIME_IDENTITY_CHANGED' }
    $socketLines = @(& (Join-Path $script:system 'System32\netstat.exe') -ano -p tcp)
    if ($LASTEXITCODE -ne 0) { throw 'LOOPBACK_OWNER_REJECTED' }
    $listeners = @($socketLines | Where-Object { $_ -match ('^\s*TCP\s+\S+:' + $portNumber + '\s+\S+:0\s+\S+\s+\d+\s*$') })
    $script:runtimeProof.listenerPresent=($listeners.Count -gt 0)
    $socketOwnerMatches=$false
    if ($listeners.Count -eq 1) {
        $socketFields=([string]$listeners[0]).Trim() -split '\s+'
        $socketOwnerMatches=($socketFields.Count -eq 5 -and $socketFields[0] -eq 'TCP' -and $socketFields[1] -eq ('127.0.0.1:'+[string]$portNumber) -and $socketFields[2] -eq '0.0.0.0:0' -and $socketFields[4] -eq [string]$server[0].ProcessId)
    }
    if ($listeners.Count -gt 0 -and -not $socketOwnerMatches) {
        $script:runtimeProof.mismatch='LISTENER_MISMATCH'
        $script:runtimeProof.listenerCount=$listeners.Count
        $script:runtimeProof.expectedServerPid=[int]$server[0].ProcessId
        $script:runtimeProof.expectedPort=$portNumber
        $script:runtimeProof.socketTokens=@($listeners | ForEach-Object {
            $tokens=([string]$_).Trim() -split '\s+'
            @{loopback=($tokens[1] -like '127.0.0.1:*');port=($tokens[1] -split ':')[-1];owner=$tokens[-1];state=$tokens[-2]}
        })
        throw 'LOOPBACK_OWNER_REJECTED'
    }
    $script:base = [string]$info.url; $script:supervisorPid = [int]$info.pid
    $script:runtimeProof.mismatch='NONE'; $script:runtimeProof.verified=$true
    return $true
}
function Wait-Until([scriptblock]$Condition, [int]$Seconds, [string]$Code) {
    $end = [DateTime]::UtcNow.AddSeconds($Seconds)
    $nextProgress = [DateTime]::UtcNow.AddSeconds(10)
    while ([DateTime]::UtcNow -lt $end) {
        Assert-Bound; Assert-Spawn $script:app
        $conditionResult = @(& $Condition)
        if ($conditionResult.Count -ne 1 -or $conditionResult[0] -isnot [bool]) { throw 'CONDITION_RESULT_REJECTED' }
        if ($conditionResult[0]) { return }
        if ([DateTime]::UtcNow -ge $nextProgress) {
            Write-SafeProgress $script:stage; $nextProgress=[DateTime]::UtcNow.AddSeconds(10)
        }
        Start-Sleep -Milliseconds 250
    }
    throw $Code
}
function Invoke-CrmApi([string]$Route, [string]$Method = 'GET', $Body = $null) {
    if (-not (Assert-OwnedRuntime)) { throw 'FRESH_RUNTIME_REQUIRED' }
    $opts = @{Uri="$script:base$Route";Method=$Method;Headers=@{Origin=$script:base};WebSession=$script:session;TimeoutSec=10;MaximumRedirection=0;ErrorAction='Stop'}
    if ($null -ne $Body) { $opts.ContentType='application/json'; $opts.Body=$Body | ConvertTo-Json -Depth 6 -Compress }
    try { return Invoke-RestMethod @opts } catch { throw 'API_CALL_FAILED' }
}
function Stop-Owned {
    $failed = $false
    $teardown = [Diagnostics.Stopwatch]::StartNew()
    foreach ($o in $script:spawns) {
        try {
            if (-not $o.Started) { continue }
            if (-not $o.Process.HasExited) {
                Assert-Spawn $o
                $parents = @(@{Id=$o.Process.Id;Start=$o.Process.StartTime.ToUniversalTime()})
                for ($depth=0; $depth -lt 3 -and $parents.Count; $depth++) {
                    $next = @()
                    foreach ($parent in $parents) {
                        foreach ($p in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($parent.Id)")) {
                            $start=([datetime]$p.CreationDate).ToUniversalTime()
                            if (($p.ExecutablePath -ieq $script:nodeExe -or $p.ExecutablePath -ieq (Join-Path $script:system 'System32\conhost.exe')) -and $start -ge $parent.Start) {
                                $script:runtimePins[[string]$p.ProcessId]=Get-ProcessStamp $p
                                $script:runtimeImages[[string]$p.ProcessId]=[string]$p.ExecutablePath
                                $next+=@{Id=$p.ProcessId;Start=$start}
                            }
                        }
                    }
                    $parents=$next
                }
                Assert-Spawn $o
                $o.Process.Kill() # retained handle ONLY; no Kill(true), PID, shutdown command or UI control
                $remainingMs = [Math]::Max(0,20000 - [int]$teardown.ElapsedMilliseconds)
                if (-not $o.Process.WaitForExit($remainingMs)) { throw 'OWNED_EXIT_TIMEOUT' }
            }
        } catch { $failed = $true }
    }
    do {
        $remaining = @(Get-CimInstance Win32_Process | Where-Object {
            $key = [string]$_.ProcessId
            $script:runtimePins.ContainsKey($key) -and $script:runtimeImages.ContainsKey($key) -and $_.ExecutablePath -ieq $script:runtimeImages[$key] -and
                (Get-ProcessStamp $_) -eq $script:runtimePins[$key]
        })
        if (-not $remaining.Count) { break }; Start-Sleep -Milliseconds 200
    } while ($teardown.Elapsed.TotalSeconds -lt 20)
    if ($remaining.Count -or $failed) { throw 'OWNED_CLEANUP_FAILED' }
    Assert-NoOtherCrm
    foreach ($o in $script:spawns) { $o.Process.Dispose() }
    $script:retiredSupervisorPid=$script:supervisorPid
    $script:spawns.Clear(); $script:runtimePins.Clear(); $script:runtimeImages.Clear(); $script:supervisorPid = 0; $script:app = $null
}

if (-not $ExecuteInstalledNative) { Write-Output '{"status":"NOT_EXECUTED","code":"OPT_IN_REQUIRED"}'; return }
$script:runRoot = $null
try {
    if (-not $IsWindows -or -not [Environment]::Is64BitProcess) { throw 'PLATFORM_REJECTED' }
    $workspace = Assert-LocalPath ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')))
    $script:system = Assert-LocalPath $SystemDirectory
    $null = Assert-Leaf (Join-Path $script:system 'System32\kernel32.dll')
    $script:exe = Assert-Leaf $Launcher
    if ([IO.Path]::GetFileName($script:exe) -ine 'RealEstateCRM.exe' -or (Test-Contained $workspace $script:exe)) { throw 'INSTALLED_LAUNCHER_REJECTED' }
    if ((Get-FileHash -LiteralPath $script:exe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $officialHash) { throw 'LAUNCHER_HASH_REJECTED' }
    $script:installDir = [IO.Path]::GetDirectoryName($script:exe)
    $script:nodeExe = Assert-Leaf (Join-Path $script:installDir 'app\node\node.exe')
    $script:serverJs = Assert-Leaf (Join-Path $script:installDir 'app\server.js')
    $script:notifWorker = Assert-Leaf (Join-Path $script:installDir 'app\workers\notifications.cjs')
    Assert-NoOtherCrm # Never exit/modify the existing default-profile application.
    $lnk = Assert-Leaf $InstalledShortcut
    if ([IO.Path]::GetExtension($lnk) -ine '.lnk' -or (Test-Contained $workspace $lnk) -or
        $InstalledShortcutSha256 -notmatch '^[a-fA-F0-9]{64}$' -or
        (Get-FileHash -LiteralPath $lnk -Algorithm SHA256).Hash -ine $InstalledShortcutSha256) { throw 'SHORTCUT_PROVENANCE_REJECTED' }
    $shell = New-Object -ComObject WScript.Shell
    try {
        $sc = $shell.CreateShortcut($lnk) # metadata only: NEVER Save/Run/ShellExecute
        try {
            if ((Assert-Leaf $sc.TargetPath) -ine $script:exe -or -not [string]::IsNullOrWhiteSpace($sc.Arguments) -or
                (Assert-LocalPath $sc.WorkingDirectory) -ine $script:installDir) { throw 'SHORTCUT_TARGET_REJECTED' }
        } finally { $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($sc) }
    } finally { $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }
    $runId = [Guid]::NewGuid().ToString()
    $evidenceRoot = Join-Path $workspace 'data\qa-v32-installed-native-lifecycle'
    [IO.Directory]::CreateDirectory((Assert-LocalPath $evidenceRoot)) | Out-Null
    $script:runRoot = Join-Path $evidenceRoot $runId
    if (Test-Path -LiteralPath $script:runRoot) { throw 'FIXTURE_EXISTS' }
    $acl = [Security.AccessControl.DirectorySecurity]::new(); $acl.SetAccessRuleProtection($true,$false)
    foreach ($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
    }
    $dirInfo = [IO.DirectoryInfo]::new($script:runRoot)
    [IO.FileSystemAclExtensions]::Create($dirInfo,$acl)
    if (-not (Get-Acl -LiteralPath $script:runRoot).AreAccessRulesProtected) { throw 'ACL_REJECTED' }
    $script:dirs = @{}
    foreach ($sub in @('localappdata','roaming','temp','home')) { $script:dirs[$sub]=Join-Path $script:runRoot $sub; [IO.Directory]::CreateDirectory($script:dirs[$sub]) | Out-Null }
} catch {
    Write-Output (@{status='REFUSED';code='PREFLIGHT_REFUSED';failure=(Get-SafeFailure $_)} | ConvertTo-Json -Depth 4 -Compress)
    exit 1
}

$script:clock = [Diagnostics.Stopwatch]::StartNew()
$script:checks = [Collections.Generic.List[object]]::new(); $script:spawns = [Collections.Generic.List[object]]::new()
$script:runtimePins = @{}; $script:runtimeImages = @{}; $script:supervisorPid=0; $script:retiredSupervisorPid=0; $script:app=$null; $script:base=$null
$script:runtimeProof=@{mismatch='NOT_CHECKED';runtimePresent=$false;serverUnique=$false;workerUnique=$false;listenerPresent=$false;verified=$false}
$script:runtimeJson=Join-Path $script:dirs.localappdata 'RealEstateCRM\logs\runtime.json'
$script:session=[Microsoft.PowerShell.Commands.WebRequestSession]::new(); $password=$null
$failed=$false; $stage='START'; $cleanup='NOTRUN'; $failure=$null; $cleanupFailure=$null; $script:childImageKind=$null
try {
    Write-SafeProgress $stage
    Add-Check 'INSTALLED_SHORTCUT_METADATA_ONLY' 'PASS'
    foreach ($code in @('INSTALLED_SHORTCUT_ACTIVATION','NATIVE_LOGIN','NATIVE_PICKER','TRAY','OFFLINE','HOST_REBOOT')) { Add-Check $code 'NOTRUN' }
    Assert-NoOtherCrm; $script:app=Start-Owned
    $stage='FRESH_RUNTIME_WAIT'; Write-SafeProgress $stage
    Wait-Until { Assert-OwnedRuntime } 120 'READY_TIMEOUT'
    $stage='FRESH_SETUP_CHECK'; Write-SafeProgress $stage
    $setup=Invoke-CrmApi '/api/v1/desktop/setup'
    $expectedData=Join-Path $script:dirs.localappdata 'RealEstateCRM\data'
    if (-not $setup.available -or (Assert-LocalPath $setup.dataDirectory) -ine $expectedData) { throw 'FRESH_SETUP_REQUIRED' }
    Add-Check 'OWNED_NORMAL_RUNTIME_FRESH_PROFILE' 'PASS'
    try { $m=[Threading.Mutex]::OpenExisting('Local\RealEstateCRM.Desktop.Writer'); $m.Dispose() }
    catch { throw 'OWNED_WRITER_MUTEX_MISSING' }
    Add-Check 'WRITER_MUTEX_PRESENT_WITH_OWNED_RUNTIME' 'PASS'
    Wait-Until { Assert-OwnedRuntime } 10 'SECOND_LAUNCH_RUNTIME_UNVERIFIED'
    $stage='SECOND_LAUNCH'; Write-SafeProgress $stage
    $before=$script:supervisorPid; $second=Start-Owned -AllowEarlyExit
    Wait-Until { $second.Process.HasExited } 20 'SECOND_LAUNCH_TIMEOUT'
    if ($second.Process.ExitCode -ne 0 -or -not (Assert-OwnedRuntime) -or $script:supervisorPid -ne $before) { throw 'SINGLE_INSTANCE_FAILED' }
    Add-Check 'SECOND_LAUNCH_UNCHANGED_OWNED_RUNTIME' 'PASS'
    if ($WaitForController) {
        $stage='CONTROLLER'; $nonce=[Guid]::NewGuid().ToString(); $deadline=[DateTime]::UtcNow.AddSeconds($ControllerSeconds)
        Write-NewJson 'coordinator-request.json' @{schema=1;runId=$runId;nonce=$nonce;ownedLauncherPid=$script:app.Process.Id;deadlineUtc=$deadline.ToString('o');ackFile='coordinator-ack.json';required=@{runId=$runId;nonce=$nonce;code='NATIVE_SETUP_RENDER_CONFIRMED'};instruction='COMPUTER_USE_ONLY_OBSERVE_OWN_SETUP_NO_SUBMIT_NO_OTHER_WINDOW'}
        Write-Output (@{status='PAUSED';runId=$runId;fixture=$script:runRoot} | ConvertTo-Json -Compress)
        $confirmed=$false; $ack=Join-Path $script:runRoot 'coordinator-ack.json'
        $nextProgress=[DateTime]::UtcNow.AddSeconds(10)
        while ([DateTime]::UtcNow -lt $deadline) {
            if (-not (Assert-OwnedRuntime)) { throw 'CONTROLLER_RUNTIME_LOST' }
            if (Test-Path -LiteralPath $ack) {
                $a=Read-OwnedJson $ack 1024
                if (@($a.PSObject.Properties).Count -ne 3 -or $a.runId -cne $runId -or $a.nonce -cne $nonce -or $a.code -cne 'NATIVE_SETUP_RENDER_CONFIRMED') { throw 'ACK_REJECTED' }
                $confirmed=$true; break
            }
            if ([DateTime]::UtcNow -ge $nextProgress) {
                Write-SafeProgress $stage; $nextProgress=[DateTime]::UtcNow.AddSeconds(10)
            }
            Start-Sleep -Milliseconds 250
        }
        Add-Check 'COORDINATOR_NATIVE_SETUP_RENDER' $(if ($confirmed) {'PASS'} else {'NOTRUN'})
    } else { Add-Check 'COORDINATOR_NATIVE_SETUP_RENDER' 'NOTRUN' }
    $stage='SYNTHETIC_REMINDER'; Write-SafeProgress $stage
    $password=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))+'aA7!'
    $login='qa-native-'+[Guid]::NewGuid().ToString('N')
    $null=Invoke-CrmApi '/api/v1/desktop/setup' 'POST' @{login=$login;displayName='QA Synthetic';password=$password;mode='empty';dataDirectory='default';localDiskConfirmed=$true}
    $null=Invoke-CrmApi '/api/v1/auth/login' 'POST' @{login=$login;password=$password}
    $task=Invoke-CrmApi '/api/v1/tasks' 'POST' @{title='QA Synthetic Reminder';taskType='other';priority='normal';dueAt=[DateTime]::UtcNow.AddSeconds(-5).ToString('o');reminderOffsets=@()}
    $taskId=[string]$task.id
    if ($taskId -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') { throw 'TASK_ID_REJECTED' }
    Wait-Until {
        $list=Invoke-CrmApi '/api/v1/notifications?state=delivered&pageSize=20'
        @($list.items | Where-Object { $_.sourceType -eq 'task' -and $_.sourceId -eq $taskId -and $_.state -eq 'delivered' -and $_.kind -eq 'task' }).Count -gt 0
    } 45 'REMINDER_TIMEOUT'
    Add-Check 'OWNED_WORKER_DELIVERED_TASK_NOTIFICATION_NOT_OS_TOAST' 'PASS'
    $stage='RELAUNCH'; Write-SafeProgress $stage; Stop-Owned; $script:app=Start-Owned
    Wait-Until { Assert-OwnedRuntime } 120 'RELAUNCH_TIMEOUT'
    $script:session=[Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $null=Invoke-CrmApi '/api/v1/auth/login' 'POST' @{login=$login;password=$password}
    if ([string](Invoke-CrmApi "/api/v1/tasks/$taskId").id -ne $taskId) { throw 'PERSISTENCE_FAILED' }
    Add-Check 'OWNED_RELAUNCH_API_LOGIN_TASK_PERSISTENCE' 'PASS'
} catch { $failed=$true; $failure=Get-SafeFailure $_; Add-Check $stage 'FAIL' } finally {
    $password=$null; $script:session=$null
    Write-SafeProgress 'CLEANUP'
    try { Stop-Owned; $cleanup='PASS' } catch { $cleanup='FAIL'; $failed=$true; $cleanupFailure=Get-SafeFailure $_ }
    Add-Check 'OWNED_HANDLE_CLEANUP_REMAINCHECK' $cleanup
    $status=if ($failed) {'FAIL'} else {'PARTIAL'} # excluded native gates always remain NOTRUN
    $result=@{schema=1;status=$status;runId=$runId;syntheticDataOnly=$true;launcherSha256=$officialHash;sourceReference='998b59f_COORDINATOR_REFERENCE_NOT_BINARY_PROVENANCE';checks=$script:checks.ToArray();code=$(if ($failed) {'BOUNDED_PROOF_FAILED'} else {'EXCLUDED_GATES_NOTRUN'})}
    $result.failure=$failure; $result.cleanupFailure=$cleanupFailure; $result.childImageKind=$script:childImageKind; $result.runtimeProof=$script:runtimeProof
    try { Write-NewJson 'result.json' $result } catch { $failed=$true; $status='FAIL'; $failure=Get-SafeFailure $_ }
    Write-Output (@{status=$status;code=$(if ($failed) {'BOUNDED_PROOF_FAILED'} else {'EXCLUDED_GATES_NOTRUN'});runId=$runId;failure=$failure;cleanupFailure=$cleanupFailure} | ConvertTo-Json -Depth 4 -Compress)
}
if ($failed) { exit 1 }
