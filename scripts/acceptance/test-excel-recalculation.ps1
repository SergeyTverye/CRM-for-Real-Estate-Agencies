#Requires -Version 5.0
# Synthetic-only read-only native Excel recalculation proof (hidden Excel COM).
# Fixture shape inferred from PUBLIC source only:
#   scripts/acceptance/installed-import-cycle.mjs :: buildSyntheticEnterpriseWorkbook
# Technical shape: exactly 1 formula cell (arith/cell-ref, cached result); no macros/links.
# No workbook authoring/export; in-memory recalc only; file must stay immutable.
# No GetActiveObject / Stop-Process / taskkill; only owned COM instance may Quit.
# Lifecycle: Stop-Proof aborts flow (sentinel); exactly ONE report/exit AFTER finally teardown.
param(
  [switch]$RunSyntheticExcelProof,
  [string]$Workbook,
  [string]$ExpectedSha256,
  [string]$EvidenceDirectory
)
$ErrorActionPreference = 'Stop'
$sw = [Diagnostics.Stopwatch]::StartNew()
$StopSentinel = 'STOP_PROOF_ABORT'
function Stop-Proof { throw New-Object System.Exception($StopSentinel) }
$code = 'NOTRUN'; $status = 'NOTRUN'; $exit = 2
$failureLine = 0
function Get-ProofSha256([string]$File) {
  $stream = [IO.File]::OpenRead($File)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $algorithm.Dispose(); $stream.Dispose() }
}
$shaBefore = ''; $shaAfter = ''; $shaUnchanged = $false
$fCount = 0; $supported = $false; $extLinks = $false; $macros = $false
$xlVer = ''; $ownedPid = 0; $ownedStart = ''; $isOwned = $false
$fullOk = $false; $chgOk = $false; $restOk = $false; $fSame = $false; $proofOk = $false
$closedWithoutSave = $false; $closedOwn = $false; $evidenceOwned = $false
$beforeIds = @(); $excel = $null; $wb = $null
$fc = $null; $tws = $null; $inp = $null; $sheets = $null
try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (-not $RunSyntheticExcelProof) { $code = 'missing_flag'; $status = 'BLOCKED'; Stop-Proof }
  foreach ($p in @($Workbook, $EvidenceDirectory)) { if (-not $p -or -not [IO.Path]::IsPathRooted($p)) { $code = 'bad_path'; $status = 'BLOCKED'; Stop-Proof } }
  if ($Workbook -match '\.\.' -or $EvidenceDirectory -match '\.\.') { $code = 'not_canonical'; $status = 'BLOCKED'; Stop-Proof }
  if ([IO.Path]::GetFullPath($Workbook) -ine $Workbook) { $code = 'not_canonical'; $status = 'BLOCKED'; Stop-Proof }
  if ([IO.Path]::GetFullPath($EvidenceDirectory) -ine $EvidenceDirectory) { $code = 'not_canonical'; $status = 'BLOCKED'; Stop-Proof }
  if ($ExpectedSha256 -notmatch '^[0-9a-fA-F]{64}$') { $code = 'bad_hash_arg'; $status = 'BLOCKED'; Stop-Proof }
  # Strict synthetic path: .../data/qa-v32-installed-browser/<uuid>/import-cycle/exported-enterprise-roundtrip.xlsx
  if ([IO.Path]::GetFileName($Workbook) -cne 'exported-enterprise-roundtrip.xlsx') { $code = 'refuse_not_synthetic'; $status = 'BLOCKED'; Stop-Proof }
  $wbDir = Split-Path $Workbook -Parent
  if ((Split-Path $wbDir -Leaf) -cne 'import-cycle') { $code = 'refuse_not_synthetic'; $status = 'BLOCKED'; Stop-Proof }
  $runDir = Split-Path $wbDir -Parent; $runId = Split-Path $runDir -Leaf
  if ($runId -notmatch '^run-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') { $code = 'refuse_not_synthetic'; $status = 'BLOCKED'; Stop-Proof }
  $qaDir = Split-Path $runDir -Parent
  if ((Split-Path $qaDir -Leaf) -cne 'qa-v32-installed-browser') { $code = 'refuse_not_synthetic'; $status = 'BLOCKED'; Stop-Proof }
  if ((Split-Path (Split-Path $qaDir -Parent) -Leaf) -cne 'data') { $code = 'refuse_not_synthetic'; $status = 'BLOCKED'; Stop-Proof }
  $projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
  if ($qaDir -ine (Join-Path $projectRoot 'data\qa-v32-installed-browser')) { $code = 'refuse_not_synthetic'; $status = 'BLOCKED'; Stop-Proof }
  $wantEv = Join-Path $wbDir 'excel-recalc'
  if ($EvidenceDirectory -ine $wantEv) { $code = 'bad_evidence_dir'; $status = 'BLOCKED'; Stop-Proof }
  if (Test-Path $EvidenceDirectory) { $code = 'evidence_exists'; $status = 'BLOCKED'; Stop-Proof }
  # Ancestor reparse check (file + evidence ancestors up to data dir).
  $toCheck = @($wbDir, $runDir, $qaDir)
  $ancestor = Split-Path $qaDir -Parent
  while ($ancestor) { $toCheck += $ancestor; $ancestor = Split-Path $ancestor -Parent }
  foreach ($d in $toCheck) {
    $it = Get-Item $d -ErrorAction Stop
    if (($it.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $code = 'reparse_ancestor'; $status = 'BLOCKED'; Stop-Proof }
  }
  $fi = Get-Item $Workbook -ErrorAction Stop
  if (($fi.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $code = 'reparse_ancestor'; $status = 'BLOCKED'; Stop-Proof }
  $shaBefore = Get-ProofSha256 $Workbook
  if ($shaBefore -ne $ExpectedSha256.ToLower()) { $code = 'hash_mismatch'; $status = 'BLOCKED'; Stop-Proof }
  # Read-only zip XML scan: counts/booleans only, never emit values/formulas/text.
  $zr = [IO.Compression.ZipFile]::OpenRead($Workbook)
  try {
    foreach ($e in $zr.Entries) {
      $n = $e.FullName.Replace('\', '/')
      if ($n -like 'xl/externalLinks/*' -or $n -like 'xl/externalReferences/*') { $extLinks = $true }
      if ($n -ieq 'xl/vbaProject.bin' -or $n -like 'xl/vbaData*') { $macros = $true }
    }
    $wbe = $zr.Entries | Where-Object { $_.FullName.Replace('\', '/') -ieq 'xl/workbook.xml' } | Select-Object -First 1
    if ($wbe) {
      $sr = New-Object IO.StreamReader($wbe.Open()); $t = $sr.ReadToEnd(); $sr.Close()
      if ($t -match 'externalReference' -or $t -match 'vbaProject') { $extLinks = $true }
      $t = ''
    }
    $sup = 0
    foreach ($e in ($zr.Entries | Where-Object { $_.FullName -match '^xl/worksheets/sheet\d+\.xml$' })) {
      $sr = New-Object IO.StreamReader($e.Open()); $x = $sr.ReadToEnd(); $sr.Close()
      $xd = New-Object Xml.XmlDocument; $xd.LoadXml($x); $x = ''
      $fl = $xd.SelectNodes('//*[local-name()="f"]')
      $fCount += $fl.Count
      foreach ($f in $fl) {
        $ft = $f.InnerText
        $okRef = ($ft -match '[A-Z]+\d+')
        $okOp = ($ft -match '(?i)^SUM\(' -or $ft -match '[*+\-/]')
        $hasV = ($f.ParentNode -ne $null -and $f.ParentNode.SelectSingleNode('*[local-name()="v"]') -ne $null)
        if ($okRef -and $okOp -and $hasV) { $sup++ }
        $ft = ''
      }
    }
    if ($sup -eq 1 -and $fCount -eq 1) { $supported = $true }
  } finally { $zr.Dispose() }
  if ($extLinks -or $macros) { $code = 'refuse_links_or_macro'; $status = 'BLOCKED'; Stop-Proof }
  if (-not $supported) { $code = 'unexpected_formula_shape'; $status = 'BLOCKED'; Stop-Proof }
  New-Item -ItemType Directory -Path $EvidenceDirectory -ErrorAction Stop | Out-Null
  $evidenceOwned = $true; $status = 'RUNNING'; $code = 'RUNNING'
  # Ownership: snapshot existing EXCEL PIDs first (metadata only, never attach).
  $beforeIds = @(Get-Process -Name EXCEL -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  try { $excel = New-Object -ComObject Excel.Application }
  catch { $code = 'com_blocked'; $status = 'NOTRUN'; Stop-Proof }
  if ($excel -eq $null) { $code = 'com_blocked'; $status = 'NOTRUN'; Stop-Proof }
  $xlVer = [string]$excel.Version
  Add-Type @'
using System; using System.Runtime.InteropServices;
public static class W32 { [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); }
'@
  $hwnd = [IntPtr]$excel.Hwnd; [uint32]$pidOut = 0
  [void][W32]::GetWindowThreadProcessId($hwnd, [ref]$pidOut)
  $ownedPid = [int]$pidOut
  if ($ownedPid -le 0 -or ($beforeIds -contains $ownedPid)) { $code = 'ownership_unproven'; $status = 'BLOCKED'; Stop-Proof }
  try {
    $pr = Get-Process -Id $ownedPid -ErrorAction Stop
    if ($pr.ProcessName -ne 'EXCEL') { $code = 'ownership_unproven'; $status = 'BLOCKED'; Stop-Proof }
    $ownedStart = $pr.StartTime.ToUniversalTime().ToString('o')
  } catch { $code = 'ownership_unproven'; $status = 'BLOCKED'; Stop-Proof }
  $isOwned = $true
  # Early owner-proof marker BEFORE Workbook.Open/calc can hang; never rewritten later.
  "$ownedPid|$ownedStart" | Out-File (Join-Path $EvidenceDirectory 'owner.marker') -Encoding ascii
  # Hidden, silent, no links/addins.
  $excel.Visible = $false; $excel.DisplayAlerts = $false; $excel.AskToUpdateLinks = $false; $excel.EnableEvents = $false; $excel.AutomationSecurity = 3
  $wb = $excel.Workbooks.Open($Workbook, 0, $true)
  if ($wb -eq $null) { $code = 'open_failed'; $status = 'FAIL'; Stop-Proof }
  if ($wb.HasVBProject) { $code = 'refuse_links_or_macro'; $status = 'BLOCKED'; Stop-Proof }
  try { $ls = $wb.LinkSources(1); if (($null -ne $ls) -and (@($ls).Count -gt 0)) { $code = 'refuse_links_or_macro'; $status = 'BLOCKED'; Stop-Proof } } catch { if ($_.Exception.Message -eq $StopSentinel) { throw } }
  $excel.CalculateFull()
  # Exact synthetic fixture only (zip-verified single formula): first sheet C2 = B2*1000. No UsedRange/Cells enumeration (RCW leak).
  $sheets = $wb.Worksheets; $tws = $sheets.Item(1); $fc = $tws.Range('C2')
  if (-not $fc.HasFormula) { $code = 'formula_not_found'; $status = 'FAIL'; Stop-Proof }
  $origF = [string]$fc.Formula; $origV = $fc.Value2
  $canonF = $origF.Trim()
  if ($canonF.StartsWith('=')) { $canonF = $canonF.Substring(1) }
  $canonF = $canonF.Replace('$', '')
  if ($canonF -cne 'B2*1000') { $code = 'unexpected_formula_shape'; $status = 'FAIL'; Stop-Proof }
  $inp = $tws.Range('B2')
  $origIn = $inp.Value2
  if (-not (($origIn -is [double] -or $origIn -is [int] -or $origIn -is [decimal]) -and [Math]::Abs([double]$origIn - 125.5) -le 1e-6)) { $code = 'unexpected_input_shape'; $status = 'FAIL'; Stop-Proof }
  if (-not (($origV -is [double] -or $origV -is [int] -or $origV -is [decimal]) -and [Math]::Abs([double]$origV - 125500) -le 1e-6)) { $code = 'recalc_mismatch'; $status = 'FAIL'; Stop-Proof }
  $fullOk = $true
  $inp.Value2 = 126.5
  $excel.CalculateFullRebuild()
  $newV = $fc.Value2
  $chgOk = $false
  if ((($newV -is [double]) -or ($newV -is [int]) -or ($newV -is [decimal])) -and ([Math]::Abs([double]$newV - 126500) -le 1e-6)) { $chgOk = $true }
  $inp.Value2 = $origIn
  $excel.CalculateFullRebuild()
  $restV = $fc.Value2; $restF = [string]$fc.Formula
  $restCanon = $restF.Trim()
  if ($restCanon.StartsWith('=')) { $restCanon = $restCanon.Substring(1) }
  $restCanon = $restCanon.Replace('$', '')
  $restOk = $false
  if ((($restV -is [double]) -or ($restV -is [int]) -or ($restV -is [decimal])) -and ([Math]::Abs([double]$restV - 125500) -le 1e-6)) { $restOk = $true }
  $fSame = (($restCanon -ceq 'B2*1000') -and ($restF -ceq $origF))
  $origF = ''; $origV = $null; $newV = $null; $restV = $null; $restF = ''; $origIn = $null; $canonF = ''; $restCanon = ''
  if (-not ($fullOk -and $chgOk -and $restOk -and $fSame)) { $code = 'recalc_mismatch'; $status = 'FAIL'; Stop-Proof }
  $proofOk = $true
  # PASS is decided ONLY after finally teardown + re-hash below; never here.
} catch {
  $failureLine = [int]$_.InvocationInfo.ScriptLineNumber
  if ($_.Exception.Message -eq $StopSentinel) {
    # Assigned code/status preserved; no emit here.
  } else {
    # Unexpected: fixed code only; explicit preflight BLOCKED preserved.
    if ($status -eq 'BLOCKED') { if ($code -eq 'NOTRUN') { $code = 'failed' } }
    else { $status = 'FAIL'; $code = 'failed' }
  }
  if ($exit -eq 2 -and $status -eq 'FAIL') { $exit = 1 }
} finally {
  try { if ($wb -ne $null) { $wb.Close($false); $closedWithoutSave = $true } } catch {}
  foreach ($r in @($inp, $fc, $tws, $sheets, $wb)) {
    try { if ($r -ne $null) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($r) } } catch {}
  }
  $inp = $null; $fc = $null; $tws = $null; $sheets = $null; $wb = $null
  try {
    if ($excel -ne $null) {
      if ($isOwned) {
        $excel.Quit()
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
        [GC]::Collect(); [GC]::WaitForPendingFinalizers(); [GC]::Collect()
        for ($i = 0; $i -lt 40; $i++) {
          if ((Get-Process -Id $ownedPid -ErrorAction SilentlyContinue) -eq $null) { break }
          Start-Sleep -Milliseconds 200
        }
        if ((Get-Process -Id $ownedPid -ErrorAction SilentlyContinue) -eq $null) { $closedOwn = $true }
      } else { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
    }
  } catch {}
  $excel = $null
}
# Post-cleanup: re-hash original (immutability) AFTER Close; then decide PASS.
try { $shaAfter = Get-ProofSha256 $Workbook } catch {}
if ($shaBefore -ne '' -and $shaAfter -ceq $shaBefore) { $shaUnchanged = $true }
if ($status -eq 'BLOCKED' -or $status -eq 'NOTRUN') {
  $exit = 2
} elseif ($proofOk -and $closedWithoutSave -and $closedOwn -and $shaUnchanged -and $fullOk -and $chgOk -and $restOk -and $fSame) {
  $code = 'PASS'; $status = 'PASS'; $exit = 0
} else {
  $status = 'FAIL'
  if ($code -eq 'NOTRUN' -or $code -eq 'RUNNING' -or $code -eq 'PASS') { $code = 'failed' }
  $exit = 1
}
# Exactly ONE final report/exit, after teardown, with truthful flags; marker never rewritten here.
$o = [ordered]@{ status = $status; code = $code; workbookSha256 = $shaBefore; shaUnchanged = $shaUnchanged; formulaCellCount = $fCount
  supportedFormulaFound = $supported; externalLinksFound = $extLinks; macrosFound = $macros; excelVersion = $xlVer
  ownedPid = $ownedPid; ownedStartTime = $ownedStart; isNewOwnedInstance = $isOwned; fullCalcOk = $fullOk
  inputChangeOk = $chgOk; restoreOk = $restOk; formulaUnchanged = $fSame; closedWithoutSave = $closedWithoutSave
  closedOwnProcess = $closedOwn; evidenceDir = $EvidenceDirectory; durationMs = $sw.ElapsedMilliseconds }
try { if ($evidenceOwned) { $o | ConvertTo-Json -Depth 3 | Out-File (Join-Path $EvidenceDirectory 'result.json') -Encoding utf8 } } catch {}
Write-Host ("RESULT code={0} status={1} formulas={2} supported={3} ext={4} macro={5} xl={6} pid={7} owned={8} shaOk={9} line={10}" -f $code, $status, $fCount, $supported, $extLinks, $macros, $xlVer, $ownedPid, $isOwned, $shaUnchanged, $failureLine)
exit $exit
