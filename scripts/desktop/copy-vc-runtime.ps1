param([Parameter(Mandatory)][string]$Destination)
$ErrorActionPreference='Stop'
$vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vs=(& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
if (-not $vs) { throw 'MSVC_REDIST_NOT_FOUND' }
$base=Join-Path $vs 'VC\Redist\MSVC'
$version=Get-ChildItem -LiteralPath $base -Directory | Where-Object { $_.Name -match '^14\.\d+\.\d+$' } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $version) { throw 'MSVC_REDIST_VERSION_NOT_FOUND' }
$crt=Get-ChildItem -LiteralPath (Join-Path $version.FullName 'x64') -Directory -Filter 'Microsoft.VC*.CRT' | Select-Object -First 1
if (-not $crt) { throw 'MSVC_CRT_NOT_FOUND' }
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$manifest=@()
function Get-Sha256Hex([string]$Path) {
  $sha=[System.Security.Cryptography.SHA256]::Create(); $stream=[System.IO.File]::OpenRead($Path)
  try { return ([System.BitConverter]::ToString($sha.ComputeHash($stream)) -replace '-','').ToLowerInvariant() } finally { $stream.Dispose(); $sha.Dispose() }
}
foreach($file in Get-ChildItem -LiteralPath $crt.FullName -File -Filter '*.dll') {
  Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $Destination $file.Name)
  $manifest+=@{name=$file.Name;fileVersion=$file.VersionInfo.FileVersion;sha256=(Get-Sha256Hex $file.FullName)}
}
if ($manifest.Count -eq 0) { throw 'MSVC_CRT_EMPTY' }
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Destination 'MSVC-RUNTIME.json') -Encoding utf8
Write-Output 'APP_LOCAL_MSVC_RUNTIME_READY'
