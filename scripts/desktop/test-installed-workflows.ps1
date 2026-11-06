#requires -Version 7.2
<#!
Opt-in synthetic installed supervisor acceptance. Never installs/uninstalls/builds.
No transcript, HTTP tracing or debugger: generated credentials exist only in memory.
Native mailbox replay is NOT evidence of an actual Windows file picker.
!#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$InstallDirectory,
    [Parameter(Mandatory)][string]$DataRoot,
    [switch]$RunInstalledWorkflows,
    [switch]$ReplayNativeMailbox,
    [string]$UsbDirectory,
    [switch]$AllowUsbExport
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
$DebugPreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
$script:app = $null
$script:reportFile = $null
$script:stage = 'PREFLIGHT'
$script:checks = [Collections.Generic.List[object]]::new()
$script:session = $null
$password = $phrase = $recovery = $null
$failed = $false

function FullLocal([string]$Value) {
    if ($Value -notmatch '^[A-Za-z]:[\\/]' -or $Value -match '[\x00-\x1f]' -or
        $Value.Substring(2).Contains(':') -or $Value -match '(^|[\\/])\.\.?([\\/]|$)') { throw 'PATH_REJECTED' }
    $full = [IO.Path]::GetFullPath($Value).TrimEnd('\','/')
    $cursor = $full
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'REPARSE_REJECTED' }
        }
        $parent = [IO.Directory]::GetParent($cursor)
        if ($null -eq $parent) { break }
        $cursor = $parent.FullName
    }
    return $full
}
function SamePath([string]$A,[string]$B) { return $A.Equals($B,[StringComparison]::OrdinalIgnoreCase) }
function Check([bool]$Ok,[string]$Code) {
    $script:checks.Add(@{ code=$Code; passed=$Ok })
    if (-not $Ok) { throw 'CHECK_FAILED' }
}
function FreshDirectory([string]$Path) {
    if (Test-Path -LiteralPath $Path) { throw 'EXISTING_PATH_REJECTED' }
    [IO.Directory]::CreateDirectory($Path) | Out-Null
}
function WriteNew([string]$Path,[string]$Text) {
    $stream = [IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $bytes=[Text.UTF8Encoding]::new($false).GetBytes($Text); $stream.Write($bytes,0,$bytes.Length) }
    finally { $stream.Dispose() }
}
function ReadOwnedJson([string]$Path) {
    $canonical = FullLocal $Path
    if (-not $canonical.StartsWith($script:runRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'READ_SCOPE' }
    $item = Get-Item -LiteralPath $canonical
    if ($item.PSIsContainer -or $item.Length -gt 1MB) { throw 'JSON_SIZE' }
    return [IO.File]::ReadAllText($canonical) | ConvertFrom-Json
}
function WaitFor([scriptblock]$Condition,[int]$Seconds=90) {
    $end=[DateTime]::UtcNow.AddSeconds($Seconds)
    while ([DateTime]::UtcNow -lt $end) {
        if ($script:app -and $script:app.HasExited) { throw 'OWN_APP_EXITED' }
        if (& $Condition) { return }
        Start-Sleep -Milliseconds 300
    }
    throw 'WAIT_TIMEOUT'
}
function Api([string]$Path,[string]$Method='GET',$Body=$null) {
    $options=@{ Uri=$script:base+$Path; Method=$Method; Headers=@{Origin=$script:base};
        WebSession=$script:session; TimeoutSec=15; MaximumRedirection=0; ErrorAction='Stop' }
    if ($null -ne $Body) { $options.ContentType='application/json'; $options.Body=($Body | ConvertTo-Json -Depth 8 -Compress) }
    # Never emit an HTTP error body or invocation arguments to reports/stdout.
    try { return Invoke-RestMethod @options } catch { throw 'API_FAILED' }
}
function Control($Body) { return Api '/api/v1/settings/backups/control' 'POST' $Body }
function Uuid([string]$Value) {
    if ($Value -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') { throw 'ID_REJECTED' }
    return $Value
}
function ServerIdentity {
    $info=ReadOwnedJson $script:runtime
    if ($info.url -notmatch '^http://127\.0\.0\.1:[0-9]{1,5}$') { throw 'RUNTIME_URL' }
    $owner=Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$info.pid)"
    if (-not $owner -or $owner.ParentProcessId -ne $script:app.Id -or
        -not (SamePath $owner.ExecutablePath $script:node)) { throw 'RUNTIME_OWNER' }
    $script:base=$info.url
    $servers=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$([int]$info.pid)" |
        Where-Object { $_.ExecutablePath -and (SamePath $_.ExecutablePath $script:node) -and $_.CommandLine -match 'server\.js' })
    if ($servers.Count -ne 1) { throw 'SERVER_OWNER' }
    return [int]$servers[0].ProcessId
}
function Ready {
    try {
        $null=ServerIdentity
        return (Invoke-WebRequest ($script:base+'/api/health/ready') -TimeoutSec 2 -MaximumRedirection 0).StatusCode -eq 200
    } catch { return $false }
}
function Command($Body,[string]$Expected) {
    $oldServer=ServerIdentity
    $queued=Control $Body
    Check ($queued.queued -eq $true) 'command-queued'
    $id=Uuid $queued.requestId
    $resultFile=Join-Path $DataRoot "data\backup-settings\commands\$id.result.json"
    WaitFor { Test-Path -LiteralPath $resultFile }
    $result=ReadOwnedJson $resultFile
    Check ($result.id -eq $id -and $result.action -eq $Body.action -and $result.status -eq $Expected) 'command-result'
    WaitFor { Ready }
    Check ((ServerIdentity) -ne $oldServer) 'supervisor-restarted-server'
    # Restore can replace sessions. Always reauthenticate with memory-only credentials.
    $script:session=[Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $null=Api '/api/v1/auth/login' 'POST' @{login='qa-installed-manager';password=$password}
    return $result
}
function RandomHex([int]$Count=32) { return [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes($Count)).ToLowerInvariant() }
function TextHash([string]$Text) { return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Text))).ToLowerInvariant() }
function DownloadCheck([string]$Id,[string]$ExpectedHash,[string]$Leaf) {
    $file=Join-Path $script:runRoot $Leaf
    if (Test-Path -LiteralPath $file) { throw 'DOWNLOAD_EXISTS' }
    try { Invoke-WebRequest ($script:base+"/api/v1/documents/$Id/download") -WebSession $script:session -OutFile $file -TimeoutSec 15 -MaximumRedirection 0 | Out-Null }
    catch { throw 'DOWNLOAD_FAILED' }
    Check ((Get-FileHash -LiteralPath (FullLocal $file) -Algorithm SHA256).Hash.ToLowerInvariant() -eq $ExpectedHash) 'document-sha256'
}
function ReplayExport([string]$BackupId,[string]$Target,[string]$ExpectedHash) {
    $request=Control @{action='native-export';backupId=$BackupId}
    $id=Uuid $request.requestId
    $mail=Join-Path $DataRoot 'data\backup-settings\native-dialogs'
    WriteNew (Join-Path $mail "$id.path") $Target
    WaitFor {
        $r=Control @{action='native-result';requestId=$id}
        if ($r.status -eq 'failed') { throw 'EXPORT_FAILED' }
        return $r.status -eq 'exported'
    }
    Check ((Get-FileHash -LiteralPath (FullLocal $Target) -Algorithm SHA256).Hash.ToLowerInvariant() -eq $ExpectedHash) 'REPLAY-export-sha256'
}
try {
    if (-not $RunInstalledWorkflows) { throw 'EXPLICIT_OPT_IN_REQUIRED' }
    if (-not $IsWindows -or -not [Environment]::Is64BitProcess) { throw 'WINDOWS_X64_REQUIRED' }
    if ([bool]$UsbDirectory -ne [bool]$AllowUsbExport -or ($AllowUsbExport -and -not $ReplayNativeMailbox)) { throw 'USB_OPT_IN_REQUIRED' }
    $workspace=FullLocal ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')))
    # Resolve script root without accepting parent traversal in user-provided paths.
    $InstallDirectory=FullLocal $InstallDirectory
    $expectedInstall=FullLocal (Join-Path $env:LOCALAPPDATA 'Programs\RealEstateCRM')
    if (-not (SamePath $InstallDirectory $expectedInstall)) { throw 'INSTALL_ROOT_REJECTED' }
    $DataRoot=FullLocal $DataRoot
    $qaRoot=Join-Path $workspace 'data\qa-v32-installed'
    $relative=[IO.Path]::GetRelativePath($qaRoot,$DataRoot)
    if ($relative -notmatch '^run-[0-9]{8}T[0-9]{9}Z-[a-f0-9]{8}\\localappdata\\RealEstateCRM$') { throw 'DATA_ROOT_REJECTED' }
    $script:runRoot=FullLocal (Join-Path $qaRoot ($relative.Split('\')[0]))
    if (Test-Path -LiteralPath $script:runRoot) { throw 'FRESH_PROFILE_REQUIRED' }
    $exe=Join-Path $InstallDirectory 'RealEstateCRM.exe'
    $script:node=Join-Path $InstallDirectory 'app\node\node.exe'
    foreach ($file in @($exe,$script:node)) { if (-not (Test-Path -LiteralPath (FullLocal $file) -PathType Leaf)) { throw 'INSTALLED_BINARY_MISSING' } }
    # Fail closed on any other app; never stop it or invoke the global stop event.
    if (@(Get-Process -Name RealEstateCRM -ErrorAction SilentlyContinue).Count) { throw 'OTHER_APP_RUNNING' }
    try { $mutex=[Threading.Mutex]::OpenExisting('Local\RealEstateCRM.Desktop.Writer'); $mutex.Dispose(); throw 'OTHER_WRITER_RUNNING' }
    catch [Threading.WaitHandleCannotBeOpenedException] { }
    $usbRoot=$null
    if ($AllowUsbExport) {
        $usbRoot=FullLocal $UsbDirectory
        if (-not (Test-Path -LiteralPath $usbRoot -PathType Container)) { throw 'USB_DIRECTORY_REQUIRED' }
    }
    FreshDirectory $script:runRoot
    # Owner + SYSTEM only, inherited by synthetic files. Do not change parent ACLs.
    $acl=[Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true,$false)
    foreach ($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
    }
    Set-Acl -LiteralPath $script:runRoot -AclObject $acl
    $script:reportFile=Join-Path $script:runRoot 'safe-report.json'
    WriteNew (Join-Path $script:runRoot 'SYNTHETIC-QA-ONLY.txt') 'Disposable installed supervisor QA. Never reuse this profile.'
    $local=Join-Path $script:runRoot 'localappdata'
    foreach ($dir in @($local,(Join-Path $script:runRoot 'roaming'),(Join-Path $script:runRoot 'temp'))) { FreshDirectory $dir }
    $script:runtime=Join-Path $DataRoot 'logs\runtime.json'
    $script:stage='START'
    $start=[Diagnostics.ProcessStartInfo]::new($exe)
    $start.UseShellExecute=$false; $start.CreateNoWindow=$true; $start.WorkingDirectory=$InstallDirectory
    $start.ArgumentList.Add('--smoke'); $start.ArgumentList.Add('--smoke-seconds=1800')
    # Do not inherit DB/storage/backup credentials or path overrides from the caller.
    $start.Environment.Clear()
    foreach ($key in @('SystemRoot','WINDIR','USERPROFILE','USERNAME','USERDOMAIN','COMSPEC','ProgramFiles','ProgramFiles(x86)','ProgramData','SystemDrive')) {
        $value=[Environment]::GetEnvironmentVariable($key)
        if ($value) { $start.Environment[$key]=$value }
    }
    $start.Environment['LOCALAPPDATA']=$local
    $start.Environment['APPDATA']=Join-Path $script:runRoot 'roaming'
    $start.Environment['TEMP']=Join-Path $script:runRoot 'temp'
    $start.Environment['TMP']=$start.Environment['TEMP']
    $start.Environment['PATH']=(Join-Path $env:SystemRoot 'System32')+';'+(Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0')
    $script:app=[Diagnostics.Process]::Start($start)
    WaitFor { (Test-Path -LiteralPath $script:runtime) -and (Ready) } 150
    Check ($script:base -match '^http://127\.0\.0\.1:') 'owned-loopback-ready'
    # Bundled native runtime only, never host Node/npm.
    $versionStart=[Diagnostics.ProcessStartInfo]::new($script:node)
    $versionStart.UseShellExecute=$false; $versionStart.CreateNoWindow=$true; $versionStart.RedirectStandardOutput=$true
    $versionStart.ArgumentList.Add('--version'); $versionStart.Environment.Clear()
    $versionProcess=[Diagnostics.Process]::Start($versionStart)
    $version=$versionProcess.StandardOutput.ReadToEnd(); $versionProcess.WaitForExit()
    Check ($versionProcess.ExitCode -eq 0 -and $version -match '^v24\.') 'bundled-node24'
    $versionProcess.Dispose()
    $password=(RandomHex)+'aA7!'; $phrase=RandomHex
    $raw=RandomHex; $recovery='CRM1-'+$raw+'-'+(TextHash $raw).Substring(0,12); $raw=$null
    $script:session=[Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $script:stage='SETUP'
    Check ((Api '/api/v1/desktop/setup').available -eq $true) 'fresh-setup-available'
    $null=Api '/api/v1/desktop/setup' 'POST' @{login='qa-installed-manager';displayName='QA synthetic manager';password=$password;mode='empty';dataDirectory='default';localDiskConfirmed=$true}
    $null=Api '/api/v1/auth/login' 'POST' @{login='qa-installed-manager';password=$password}
    $client=Api '/api/v1/clients' 'POST' @{displayName='QA SYNTHETIC BEFORE';clientKind='person';contacts=@()}
    $clientId=Uuid $client.id
    $source=Join-Path $script:runRoot 'synthetic.txt'
    $text="SYNTHETIC installed backup document`n"; WriteNew $source $text
    $documentHash=TextHash $text
    try {
        $doc=Invoke-RestMethod ($script:base+'/api/v1/documents') -Method POST -Headers @{Origin=$script:base} -WebSession $script:session -TimeoutSec 15 -MaximumRedirection 0 -Form @{file=(Get-Item -LiteralPath $source);documentTypeCode='other';linkKind='client';linkId=$clientId}
    } catch { throw 'UPLOAD_FAILED' }
    $docId=Uuid $doc.id
    DownloadCheck $docId $documentHash 'before.txt'
    $script:stage='CREATE_VERIFY'
    $created=Command @{action='create';passphrase=$phrase;recoveryKey=$recovery;recoveryKeySaved=$true} 'verified'
    $backupId=Uuid $created.archive.backupId
    $archive=FullLocal (Join-Path $DataRoot "backups\portable\$backupId.crmbackup")
    $archiveSize=(Get-Item -LiteralPath $archive).Length
    Check ($archiveSize -gt 32 -and $archiveSize -le 256MB) 'synthetic-archive-size-cap'
    $archiveHash=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    Check ($archiveHash -eq $created.archive.sha256 -and $archiveSize -eq $created.archive.size) 'archive-sha256-size'
    $null=Command @{action='verify';backupId=$backupId;recoveryKey=$recovery} 'verified'
    $script:stage='MUTATE_RESTORE'
    $card=Api "/api/v1/clients/$clientId"
    $null=Api "/api/v1/clients/$clientId" 'PATCH' @{expectedUpdatedAt=$card.updatedAt;displayName='QA SYNTHETIC AFTER'}
    Check ((Api "/api/v1/clients/$clientId").displayName -eq 'QA SYNTHETIC AFTER') 'change-visible-before-rollback'
    $restored=Command @{action='restore';backupId=$backupId;passphrase=$phrase;confirmed=$true} 'restored'
    $protective=Uuid $restored.protectiveBackupId
    Check ($protective -ne $backupId -and (Test-Path -LiteralPath (FullLocal (Join-Path $DataRoot "backups\portable\$protective.crmbackup")))) 'protective-backup-exists'
    Check ((Api "/api/v1/clients/$clientId").displayName -eq 'QA SYNTHETIC BEFORE') 'rollback-client-restored'
    DownloadCheck $docId $documentHash 'after.txt'
    if ($ReplayNativeMailbox) {
        $script:stage='REPLAY_EXPORT'
        ReplayExport $backupId (Join-Path $script:runRoot 'REPLAY-arbitrary-name.crmbackup') $archiveHash
        if ($AllowUsbExport) {
            $usbOwned=Join-Path $usbRoot ([IO.Path]::GetFileName($script:runRoot))
            FreshDirectory $usbOwned
            ReplayExport $backupId (Join-Path $usbOwned 'REPLAY-synthetic.crmbackup') $archiveHash
        }
    }
    $script:checks.Add(@{code='synthetic-document';sha256=$documentHash})
    $script:checks.Add(@{code='synthetic-archive';sha256=$archiveHash;bytes=$archiveSize})
    $script:stage='COMPLETE'
} catch {
    $failed=$true
    # No exception text, HTTP response, entered values, paths, tokens or credentials.
    $script:checks.Add(@{code=('FAILED_'+$script:stage);passed=$false})
} finally {
    $password=$phrase=$recovery=$null
    $script:session=$null
    if ($script:app) {
        # No --shutdown: its stop event is shared with other profiles.
        # Let the bounded smoke finish naturally; force only this process handle/tree.
        if (-not $script:app.HasExited -and -not $script:app.WaitForExit(360000)) {
            try { $script:app.Kill($true); $script:app.WaitForExit(); $script:checks.Add(@{code='owned-tree-forced-stop';passed=$false}); $failed=$true }
            catch { $script:checks.Add(@{code='OWNED_CLEANUP_FAILED';passed=$false}); $failed=$true }
        }
        $script:checks.Add(@{code='owned-launcher-exited';passed=$script:app.HasExited})
        $script:app.Dispose()
    }
    if ($script:reportFile) {
        $report=@{schema=1;actualWindowsPickerTested=$false;handoffTested=$false;installedWorkflowPassed=(-not $failed);checks=$script:checks.ToArray()}
        try { WriteNew $script:reportFile ($report | ConvertTo-Json -Depth 6) } catch { $failed=$true }
    }
}
if ($failed) { throw 'INSTALLED_WORKFLOWS_FAILED_SAFE_REPORT_ONLY' }
Write-Output 'INSTALLED_WORKFLOWS_COMPLETE_SAFE_REPORT_ONLY'
