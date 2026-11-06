param(
  [Parameter(Mandatory)][ValidateSet('Stop','Purge')][string]$Phase,
  [Parameter(Mandatory)][string]$InstallDirectory
)
$ErrorActionPreference = 'Stop'
$installation = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
if (-not [IO.Path]::IsPathRooted($installation) -or $installation.Length -lt 10) { throw 'INSTALL_SCOPE_INVALID' }
function OwnedProcesses {
  $all = @(Get-CimInstance Win32_Process)
  $owned = @{}
  foreach ($process in $all) {
    if ($process.ExecutablePath -and ($process.ExecutablePath.Equals("$installation\RealEstateCRM.exe",[StringComparison]::OrdinalIgnoreCase) -or $process.ExecutablePath.StartsWith("$installation\app\",[StringComparison]::OrdinalIgnoreCase))) {
      $owned[[int]$process.ProcessId] = $true
    }
  }
  # WebView uses a shared executable, but only descendants of this installation belong to CRM.
  do {
    $added = $false
    foreach ($process in $all) {
      if ($owned.ContainsKey([int]$process.ParentProcessId) -and -not $owned.ContainsKey([int]$process.ProcessId)) { $owned[[int]$process.ProcessId] = $true; $added = $true }
    }
  } while ($added)
  @($all | Where-Object { $owned.ContainsKey([int]$_.ProcessId) })
}
if ($Phase -eq 'Stop') {
  $deadline = (Get-Date).AddSeconds(185)
  while ((Get-Date) -lt $deadline -and @(OwnedProcesses).Count -gt 0) { Start-Sleep -Milliseconds 250 }
  $remaining = @(OwnedProcesses)
  foreach ($process in ($remaining | Sort-Object CreationDate -Descending)) {
    if ($process.ProcessId -ne $PID) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
  }
  Start-Sleep -Milliseconds 500
  if (@(OwnedProcesses).Count -ne 0) { throw 'APP_PROCESSES_REMAIN' }
  Write-Output 'APP_PROCESSES_STOPPED'
  exit 0
}
$root = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'RealEstateCRM')).TrimEnd('\')
# Never follow junctions, even when a descendant is inside an allowed directory by name.
function AssertNoReparse([string]$target) {
  $current = Get-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
  while ($current) {
    if ($current.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'PURGE_REPARSE_POINT' }
    $current = $current.Parent
  }
  if (Test-Path -LiteralPath $target) {
    foreach ($item in Get-ChildItem -LiteralPath $target -Force -Recurse -ErrorAction Stop) {
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'PURGE_REPARSE_POINT' }
    }
  }
}
AssertNoReparse $root
$failed = @()
foreach ($leaf in @('data','files','backups','logs')) {
  $target = [IO.Path]::GetFullPath((Join-Path $root $leaf))
  if ($target -ne "$root\$leaf" -or -not $target.StartsWith("$root\",[StringComparison]::OrdinalIgnoreCase)) { throw 'PURGE_SCOPE_INVALID' }
  try { if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force } }
  catch { $failed += $leaf }
}
# Enumerate only generic credentials bearing the application's exact prefix.
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CrmCredentials {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 public struct Credential { public UInt32 Flags, Type; public string TargetName, Comment; public long LastWritten; public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist, AttributeCount; public IntPtr Attributes; public string TargetAlias, UserName; }
 [DllImport("advapi32.dll",EntryPoint="CredEnumerateW",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool Enumerate(string filter,uint flags,out uint count,out IntPtr pointer);
 [DllImport("advapi32.dll",EntryPoint="CredDeleteW",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool Delete(string target,uint type,uint flags);
 [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr pointer);
}
'@
[uint32]$count=0; [IntPtr]$pointer=[IntPtr]::Zero
if ([CrmCredentials]::Enumerate('RealEstateCRM:*',0,[ref]$count,[ref]$pointer)) {
  try {
    for ($index=0; $index -lt $count; $index++) {
      $entry=[Runtime.InteropServices.Marshal]::ReadIntPtr($pointer,$index*[IntPtr]::Size)
      $credential=[Runtime.InteropServices.Marshal]::PtrToStructure($entry,[type][CrmCredentials+Credential])
      if ($credential.TargetName.StartsWith('RealEstateCRM:',[StringComparison]::Ordinal) -and $credential.Type -eq 1) {
        if (-not [CrmCredentials]::Delete($credential.TargetName,1,0)) { $failed += 'credentials' }
      }
    }
  } finally { [CrmCredentials]::CredFree($pointer) }
} elseif ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -ne 1168) { $failed += 'credentials' }
# No shared WebView/runtime uninstall, no cloud operations, no arbitrary profile cleanup.
if ($failed.Count) { Write-Output ('PURGE_REMAINS: '+($failed -join ',')); exit 1 }
Write-Output 'PURGE_COMPLETE'
