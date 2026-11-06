param([Parameter(Mandatory)][string]$Node)
$ErrorActionPreference='Stop'
# No application launch, profile lookup or user data. Syntax-check only our own file.
$root=Join-Path ([IO.Path]::GetTempPath()) ('crm-native-path-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$entry=Join-Path $root 'synthetic.mjs'
Set-Content -LiteralPath $entry -Value '// synthetic syntax-only entrypoint'
function SyntaxCheck([string]$path,[string]$cwd) {
  $psi=[Diagnostics.ProcessStartInfo]::new($Node)
  $psi.Arguments='--check "'+$path+'"'
  $psi.WorkingDirectory=$cwd
  $psi.UseShellExecute=$false
  $psi.RedirectStandardError=$true
  $psi.EnvironmentVariables.Remove('NODE_OPTIONS')
  $psi.EnvironmentVariables.Remove('NODE_PATH')
  $p=[Diagnostics.Process]::Start($psi)
  $errorText=$p.StandardError.ReadToEnd()
  $p.WaitForExit()
  $code=$p.ExitCode
  $p.Dispose()
  return @{code=$code; eisdir=$errorText.Contains('EISDIR')}
}
$bad=SyntaxCheck ('\\?\'+$entry) $root
if ($bad.code -eq 0 -or -not $bad.eisdir) { throw 'EXPECTED_NODE24_VERBATIM_REPRO_NOT_OBSERVED' }
$good=SyntaxCheck $entry $root
if ($good.code -ne 0) { throw 'NORMAL_NODE_PATH_FAILED' }
$badCwd=SyntaxCheck 'synthetic.mjs' ('\\?\'+$root)
if ($badCwd.code -eq 0 -or -not $badCwd.eisdir) { throw 'EXPECTED_NODE24_VERBATIM_CWD_REPRO_NOT_OBSERVED' }
'PASS bundled-node-verbatim-entry-repro'
'PASS bundled-node-verbatim-cwd-repro'
'PASS bundled-node-normal-entry-and-cwd'
