[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$InstallDirectory,
    [Parameter(Mandatory)][string]$RunRoot,
    [switch]$RunInstalledHandoff
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ProgressPreference=$VerbosePreference=$DebugPreference=$InformationPreference='SilentlyContinue'
$script:app=$null
$script:session=$null
$script:report=$null
$script:exeHash=$null
$script:stage='PREFLIGHT'
$script:checks=[Collections.Generic.List[object]]::new()
$script:gates=[Collections.Generic.List[string]]::new()
$script:outcome='BLOCKED'
$password=$phrase=$recovery=$null

function LocalPath([string]$Value) {
    if ($Value -notmatch '^[A-Za-z]:[\\/]' -or $Value -match '[\x00-\x1f]' -or
        $Value.Substring(2).Contains(':') -or $Value -match '(^|[\\/])\.\.?([\\/]|$)') { throw 'PATH_REJECTED' }
    $full=[IO.Path]::GetFullPath($Value).TrimEnd('\','/')
    $cursor=$full
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'REPARSE_REJECTED' }
        }
        $parent=[IO.Directory]::GetParent($cursor)
        if ($null -eq $parent) { break }
        $cursor=$parent.FullName
    }
    return $full
}
function SamePath([string]$A,[string]$B) { return $A.Equals($B,[StringComparison]::OrdinalIgnoreCase) }
function Owned([string]$Path) {
    $p=LocalPath $Path
    if (-not $p.StartsWith($RunRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'OUTSIDE_OWNED_ROOT' }
    return $p
}
function Fresh([string]$Path) {
    $p=Owned $Path
    if (Test-Path -LiteralPath $p) { throw 'FRESH_PATH_REQUIRED' }
    [IO.Directory]::CreateDirectory($p) | Out-Null
}
function WriteNew([string]$Path,[string]$Text) {
    $s=[IO.File]::Open((Owned $Path),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $b=[Text.UTF8Encoding]::new($false).GetBytes($Text); $s.Write($b,0,$b.Length) } finally { $s.Dispose() }
}
function ReadJson([string]$Path) {
    $p=Owned $Path
    $i=Get-Item -LiteralPath $p
    if ($i.PSIsContainer -or $i.Length -gt 1MB) { throw 'JSON_SIZE' }
    return [IO.File]::ReadAllText($p) | ConvertFrom-Json
}
function Check([bool]$Ok,[string]$Code) {
    $script:checks.Add(@{code=$Code;passed=$Ok})
    if (-not $Ok) { throw 'CHECK_FAILED' }
}
function Id([string]$Value) {
    if ($Value -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') { throw 'UUID_REJECTED' }
    return $Value
}
function RandomHex { return [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant() }
function TextHash([string]$Text) { return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Text))).ToLowerInvariant() }
function WaitFor([scriptblock]$Condition,[int]$Seconds=100) {
    $end=[DateTime]::UtcNow.AddSeconds($Seconds)
    while ([DateTime]::UtcNow -lt $end) {
        if ($script:app.HasExited) { throw 'OWN_LAUNCHER_EXITED' }
        if (& $Condition) { return }
        Start-Sleep -Milliseconds 400
    }
    throw 'WAIT_TIMEOUT'
}
function ServerIdentity {
    $r=ReadJson $script:runtime
    if ($r.url -notmatch '^http://127\.0\.0\.1:[0-9]{1,5}$') { throw 'RUNTIME_URL' }
    $super=Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$r.pid)"
    if (-not $super -or $super.ParentProcessId -ne $script:app.Id -or
        -not (SamePath $super.ExecutablePath $script:node)) { throw 'SUPERVISOR_OWNER' }
    $servers=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$([int]$r.pid)" |
        Where-Object { $_.ExecutablePath -and (SamePath $_.ExecutablePath $script:node) -and $_.CommandLine -match 'server\.js' })
    if ($servers.Count -ne 1) { throw 'SERVER_OWNER' }
    $script:base=$r.url
    return [int]$servers[0].ProcessId
}
function Ready {
    try {
        $null=ServerIdentity
        return (Invoke-WebRequest ($script:base+'/api/health/ready') -TimeoutSec 2 -MaximumRedirection 0).StatusCode -eq 200
    } catch { return $false }
}
function Request([string]$Path,[string]$Method='GET',$Body=$null) {
    $null=ServerIdentity
    $options=@{Uri=$script:base+$Path;Method=$Method;Headers=@{Origin=$script:base};WebSession=$script:session;
        TimeoutSec=20;MaximumRedirection=0;SkipHttpErrorCheck=$true;ErrorAction='Stop'}
    if ($null -ne $Body) { $options.ContentType='application/json';$options.Body=$Body | ConvertTo-Json -Depth 8 -Compress }
    try {
        $r=Invoke-WebRequest @options
        $data=$null
        if ($r.Content) { $data=$r.Content | ConvertFrom-Json }
        return @{status=[int]$r.StatusCode;data=$data}
    } catch { throw 'HTTP_OR_JSON_FAILED' }
}
function Api([string]$Path,[string]$Method='GET',$Body=$null) {
    $r=Request $Path $Method $Body
    if ($r.status -lt 200 -or $r.status -ge 300) { throw 'API_UNAVAILABLE_OR_REJECTED' }
    return $r.data
}
function Login {
    $script:session=[Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $null=Api '/api/v1/auth/login' 'POST' @{login='qa-handoff-manager';password=$password}
}
function AssertNoOtherApp {
    if (@(Get-Process -Name RealEstateCRM -ErrorAction SilentlyContinue).Count) { throw 'OTHER_APP_RUNNING' }
    try { $m=[Threading.Mutex]::OpenExisting('Local\RealEstateCRM.Desktop.Writer');$m.Dispose();throw 'OTHER_WRITER_RUNNING' }
    catch [Threading.WaitHandleCannotBeOpenedException] { }
}
function StartProfile([string]$Name,[bool]$New) {
    AssertNoOtherApp
    $profile=Owned (Join-Path $RunRoot $Name)
    if ($New) {
        Fresh $profile
        foreach ($leaf in @('localappdata','roaming','temp')) { Fresh (Join-Path $profile $leaf) }
    }
    $script:dataRoot=Join-Path $profile 'localappdata\RealEstateCRM'
    $script:runtime=Join-Path $script:dataRoot 'logs\runtime.json'
    $start=[Diagnostics.ProcessStartInfo]::new($script:exe)
    $start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.WorkingDirectory=$InstallDirectory
    $start.ArgumentList.Add('--smoke');$start.ArgumentList.Add('--smoke-seconds=300')
    $start.Environment.Clear()
    foreach ($key in @('SystemRoot','WINDIR','USERPROFILE','USERNAME','USERDOMAIN','COMSPEC','ProgramFiles','ProgramFiles(x86)','ProgramData','SystemDrive')) {
        $v=[Environment]::GetEnvironmentVariable($key)
        if ($v) { $start.Environment[$key]=$v }
    }
    $start.Environment['LOCALAPPDATA']=Join-Path $profile 'localappdata'
    $start.Environment['APPDATA']=Join-Path $profile 'roaming'
    $start.Environment['TEMP']=Join-Path $profile 'temp';$start.Environment['TMP']=$start.Environment['TEMP']
    $start.Environment['PATH']=(Join-Path $env:SystemRoot 'System32')+';'+(Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0')
    $script:app=[Diagnostics.Process]::Start($start)
    WaitFor { (Test-Path -LiteralPath $script:runtime) -and (Ready) } 150
    if ($New) {
        Check ((Api '/api/v1/desktop/setup').available -eq $true) ($Name+'-fresh-setup')
        $null=Api '/api/v1/desktop/setup' 'POST' @{login='qa-handoff-manager';displayName='QA synthetic handoff';password=$password;mode='empty';dataDirectory='default';localDiskConfirmed=$true}
    }
    Login
    if ($New) {
        $s=Api '/api/v1/settings/backups'
        $s.schedule.enabled=$false;$s.schedule.onClose=$false
        $null=Api '/api/v1/settings/backups' 'PUT' @{expectedUpdatedAt=$s.updatedAt;destinations=@(@{id=$script:destinationId;kind='local';enabled=$true;directory=$script:transport});schedule=$s.schedule;retention=$s.retention}
    }
}
function StopProfile {
    if ($script:app) {
        if (-not $script:app.HasExited) { $script:app.Kill($true) }
        if (-not $script:app.WaitForExit(20000)) { throw 'OWNED_TEARDOWN_TIMEOUT' }
        $script:checks.Add(@{code='owned-launcher-tree-teardown';passed=$true})
        $script:app.Dispose();$script:app=$null;$script:session=$null
    }
}
function Command($Body,[string]$Expected) {
    $old=ServerIdentity
    $r=Api '/api/v1/settings/backups/control' 'POST' $Body
    Check ($r.queued -eq $true) ($Body.action+'-queued')
    $id=Id $r.requestId
    $file=Join-Path $script:dataRoot "data\backup-settings\commands\$id.result.json"
    WaitFor { Test-Path -LiteralPath $file }
    $result=ReadJson $file
    Check ($result.id -eq $id -and $result.action -eq $Body.action -and $result.status -eq $Expected) ($Body.action+'-result-'+$Expected)
    WaitFor { Ready }
    Check ((ServerIdentity) -ne $old) ($Body.action+'-server-restarted')
    Login
    return $result
}
function ArchiveEvidence($Archive) {
    $id=Id $Archive.backupId
    $file=Join-Path $script:transport "$id\archive.crmbackup"
    WaitFor { Test-Path -LiteralPath $file }
    $file=Owned $file
    $size=(Get-Item -LiteralPath $file).Length
    Check ($size -gt 32 -and $size -le 256MB -and $size -eq $Archive.size) 'transport-real-archive-size'
    $hash=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    Check ($hash -eq $Archive.sha256) 'transport-real-archive-sha256'
    $meta=ReadJson (Join-Path $script:transport "$id\manifest.json")
    Check ($meta.backupId -eq $id -and $meta.sha256 -eq $hash) 'transport-real-manifest'
    $script:checks.Add(@{code='archive-evidence';sha256=$hash;bytes=$size})
}
function DownloadCheck([string]$Leaf) {
    $null=ServerIdentity
    $file=Owned (Join-Path $RunRoot $Leaf)
    if (Test-Path -LiteralPath $file) { throw 'DOWNLOAD_EXISTS' }
    try { Invoke-WebRequest ($script:base+"/api/v1/documents/$script:docId/download") -WebSession $script:session -OutFile $file -TimeoutSec 20 -MaximumRedirection 0 | Out-Null }
    catch { throw 'DOCUMENT_DOWNLOAD_FAILED' }
    Check ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -eq $script:docHash) 'restored-document-sha256'
}
function StandbyDenied {
    $before=Api "/api/v1/clients/$script:clientId"
    $r=Request "/api/v1/clients/$script:clientId" 'PATCH' @{expectedUpdatedAt=$before.updatedAt;displayName='QA MUST NOT WRITE'}
    Check ($r.status -eq 503 -and $r.data.error.code -eq 'INSTANCE_READ_ONLY') 'standby-direct-mutation-denied'
    $after=Api "/api/v1/clients/$script:clientId"
    Check ($after.displayName -eq $before.displayName -and $after.updatedAt -eq $before.updatedAt) 'standby-record-unchanged'
}
try {
    if (-not $RunInstalledHandoff) { throw 'EXPLICIT_OPT_IN_REQUIRED' }
    if (-not $IsWindows -or -not [Environment]::Is64BitProcess) { throw 'WINDOWS_X64_REQUIRED' }
    $workspace=LocalPath ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')))
    $InstallDirectory=LocalPath $InstallDirectory
    if (-not (SamePath $InstallDirectory (LocalPath (Join-Path $env:LOCALAPPDATA 'Programs\RealEstateCRM')))) { throw 'INSTALL_ROOT_REJECTED' }
    $RunRoot=LocalPath $RunRoot
    if (-not (SamePath ([IO.Path]::GetDirectoryName($RunRoot)) (Join-Path $workspace 'data')) -or
        [IO.Path]::GetFileName($RunRoot) -notmatch '^qa-v32-handoff-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') { throw 'RUN_ROOT_REJECTED' }
    if (Test-Path -LiteralPath $RunRoot) { throw 'FRESH_RUN_ROOT_REQUIRED' }
    $script:exe=Join-Path $InstallDirectory 'RealEstateCRM.exe'
    $script:node=Join-Path $InstallDirectory 'app\node\node.exe'
    foreach ($p in @($script:exe,$script:node)) { if (-not (Test-Path -LiteralPath (LocalPath $p) -PathType Leaf)) { throw 'INSTALLED_BINARY_MISSING' } }
    AssertNoOtherApp
    [IO.Directory]::CreateDirectory($RunRoot) | Out-Null
    $acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($true,$false)
    foreach ($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
    }
    Set-Acl -LiteralPath $RunRoot -AclObject $acl
    $script:report=Join-Path $RunRoot 'safe-report.json'
    WriteNew (Join-Path $RunRoot 'SYNTHETIC-QA-ONLY.txt') 'Disposable synthetic installed API test. Never use for customer work. Not GUI evidence.'
    $script:exeHash=(Get-FileHash -LiteralPath $script:exe -Algorithm SHA256).Hash.ToLowerInvariant()
    $script:transport=Join-Path $RunRoot 'transport';Fresh $script:transport
    $script:destinationId=[guid]::NewGuid().ToString()
    $password=(RandomHex)+'aA7!';$phrase=RandomHex
    $raw=RandomHex;$recovery='CRM1-'+$raw+'-'+(TextHash $raw).Substring(0,12);$raw=$null

    $script:stage='A_SETUP_AND_GIVE'
    StartProfile 'source-a' $true
    $client=Api '/api/v1/clients' 'POST' @{displayName='QA HANDOFF BASELINE';clientKind='person';contacts=@()}
    $script:clientId=Id $client.id
    $text="SYNTHETIC handoff attachment`n";$script:docHash=TextHash $text
    $source=Join-Path $RunRoot 'synthetic.txt';WriteNew $source $text
    try { $doc=Invoke-RestMethod ($script:base+'/api/v1/documents') -Method POST -Headers @{Origin=$script:base} -WebSession $script:session -TimeoutSec 20 -MaximumRedirection 0 -Form @{file=(Get-Item -LiteralPath $source);documentTypeCode='other';linkKind='client';linkId=$script:clientId} }
    catch { throw 'UPLOAD_FAILED' }
    $script:docId=Id $doc.id
    DownloadCheck 'a-before.txt'
    $given=Command @{action='give';passphrase=$phrase;recoveryKey=$recovery;recoveryKeySaved=$true} 'verified'
    Check ($given.readOnly -eq $true) 'give-source-read-only'
    $baseline=Id $given.archive.backupId
    ArchiveEvidence $given.archive
    StandbyDenied
    StopProfile

    $script:stage='B_RECEIVE_AND_RETURN'
    StartProfile 'recipient-b' $true
    $identityFile=Join-Path $script:dataRoot 'data\identity.json'
    $identityBefore=ReadJson $identityFile
    $null=Command @{action='verify';backupId=$baseline;destinationId=$script:destinationId;recoveryKey=$recovery} 'verified'
    $null=Command @{action='receive';backupId=$baseline;destinationId=$script:destinationId;passphrase=$phrase;confirmed=$true} 'restored'
    $identityAfter=ReadJson $identityFile
    Check ($identityBefore.instanceId -eq $identityAfter.instanceId -and $identityBefore.deviceId -eq $identityAfter.deviceId) 'receive-preserves-local-device-identity'
    Check ((Api "/api/v1/clients/$script:clientId").displayName -eq 'QA HANDOFF BASELINE') 'sequential-receive-client'
    DownloadCheck 'b-received.txt'
    $null=Command @{action='compare';backupId=$baseline;destinationId=$script:destinationId;passphrase=$phrase} 'same'
    $card=Api "/api/v1/clients/$script:clientId"
    $null=Api "/api/v1/clients/$script:clientId" 'PATCH' @{expectedUpdatedAt=$card.updatedAt;displayName='QA HANDOFF B RETURN'}
    $returned=Command @{action='give';passphrase=$phrase;recoveryKey=$recovery;recoveryKeySaved=$true} 'verified'
    $child=Id $returned.archive.backupId
    ArchiveEvidence $returned.archive
    StandbyDenied
    StopProfile

    $script:stage='A_RETURN_RECEIVE_GATE'
    StartProfile 'source-a' $false
    StandbyDenied
    $r=Request '/api/v1/settings/backups/control' 'POST' @{action='receive';backupId=$child;destinationId=$script:destinationId;passphrase=$phrase;confirmed=$true}
    if ($r.status -eq 503 -and $r.data.error.code -eq 'INSTANCE_READ_ONLY') {
        $script:gates.Add('RETURN_RECEIVE_BLOCKED_BY_STANDBY_GUARD')
        Check ((Api "/api/v1/clients/$script:clientId").displayName -eq 'QA HANDOFF BASELINE') 'blocked-return-leaves-source-unchanged'
    } else {
        Check ($r.status -eq 200 -and $r.data.queued -eq $true) 'return-receive-queued'
        $requestId=Id $r.data.requestId
        $file=Join-Path $script:dataRoot "data\backup-settings\commands\$requestId.result.json"
        WaitFor { Test-Path -LiteralPath $file }
        Check ((ReadJson $file).status -eq 'restored') 'return-receive-restored'
        WaitFor { Ready };Login
        Check ((Api "/api/v1/clients/$script:clientId").displayName -eq 'QA HANDOFF B RETURN') 'roundtrip-client'
        DownloadCheck 'a-returned.txt'
    }
    StopProfile

    $script:stage='C_DIVERGENT_COPY_CONFLICT'
    StartProfile 'divergent-c' $true
    $null=Command @{action='receive';backupId=$baseline;destinationId=$script:destinationId;passphrase=$phrase;confirmed=$true} 'restored'
    $card=Api "/api/v1/clients/$script:clientId"
    $null=Api "/api/v1/clients/$script:clientId" 'PATCH' @{expectedUpdatedAt=$card.updatedAt;displayName='QA HANDOFF C LOCAL DIVERGENCE'}
    $before=Api "/api/v1/clients/$script:clientId"
    $null=Command @{action='compare';backupId=$child;destinationId=$script:destinationId;passphrase=$phrase} 'conflict'
    $conflict=Command @{action='receive';backupId=$child;destinationId=$script:destinationId;passphrase=$phrase;confirmed=$true} 'failed'
    Check ($conflict.errorCode -eq 'TRANSFER_REVISION_CONFLICT') 'divergent-copy-receive-rejected'
    $after=Api "/api/v1/clients/$script:clientId"
    Check ($after.displayName -eq $before.displayName -and $after.updatedAt -eq $before.updatedAt) 'conflict-local-record-unchanged'
    DownloadCheck 'c-after-conflict.txt'
    ArchiveEvidence $given.archive;ArchiveEvidence $returned.archive
    StopProfile
    $script:stage='COMPLETE'
    $script:outcome=if ($script:gates.Count) { 'BLOCKED' } else { 'PASS' }
} catch {
    $script:gates.Add('GATE_'+$script:stage)
    if ($script:stage -ne 'PREFLIGHT') { $script:outcome='FAIL' }
} finally {
    $password=$phrase=$recovery=$raw=$null;$script:session=$null
    try { StopProfile } catch { $script:gates.Add('OWNED_TEARDOWN_FAILED');$script:outcome='FAIL' }
    if ($script:report) {
        $result=@{schema=1;outcome=$script:outcome;stage=$script:stage;normalGuiProven=$false;actualWindowsPickerTested=$false;
            executableSha256=$script:exeHash;gates=$script:gates.ToArray();checks=$script:checks.ToArray();finishedUtc=[DateTime]::UtcNow.ToString('o')}
        try { WriteNew $script:report ($result | ConvertTo-Json -Depth 6) } catch { $script:outcome='FAIL' }
    }
}
Write-Output ('INSTALLED_HANDOFF_'+$script:outcome+'_SAFE_AGGREGATE_ONLY')
if ($script:outcome -ne 'PASS') { exit 1 }
