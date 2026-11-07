# Workspace cleanup

UTC: 2026-11-06T23:50:56.0137658Z; execute: True; workspace: D:\CRM-for-Real-Estate-Agencies
Preflight: 28 eligible targets; 24889 files; 5591537408 bytes.
Actually deleted: 24888 files; 5591020107 bytes; refused/failed targets: 1.
Previous completed pass: 159 root log files; 2883953 bytes removed (2026-11-06).
Earlier follow-up pass: 2432 files; 1565894666 bytes removed; 8 directories deleted. Two preceding attempts deleted nothing.
Second completed follow-up pass: 2296 files; 1255321861 bytes removed; 3 directories deleted.
Cumulative with previous passes: 29775 files; 8415120587 bytes removed.

Preserved by policy (not recursively scanned): .next; desktop-artifacts/release; source, documentation, screenshots, specifications, Git, dependencies, Prisma/generated, import profiles, vendor, Real-Estate-Scrapper, backups, data, private-data, secrets, environment files and keys.
No file content or process command lines recorded. No processes stopped. Git queried only for candidate paths. Byte counts are logical file lengths, not physical disk allocation.

## Outcome groups
- DELETED: 20 targets; 3944690727 bytes removed.
- CLEANED_PROTECTED_REMAINDER: 7 targets; 1646329380 bytes removed.
- TREE_CHANGED: 1 targets; 0 bytes removed.

## Per-path refusal/failure codes
- tsconfig.tsbuildinfo: TREE_CHANGED

## Directory outcomes
- .next-3421: DELETED; files removed=301; bytes removed=207243450
- .next-3424: DELETED; files removed=468; bytes removed=565070908
- .next-3432: DELETED; files removed=62; bytes removed=108434238
- .next-3442: DELETED; files removed=101; bytes removed=86285467
- .next-3450: DELETED; files removed=153; bytes removed=102911576
- .next-3511: DELETED; files removed=95; bytes removed=91788250
- .next-3512: DELETED; files removed=115; bytes removed=109833522
- .next-acceptance-v32-desktop: CLEANED_PROTECTED_REMAINDER; files removed=881; bytes removed=180940025
- .next-backup-ui-desktop: CLEANED_PROTECTED_REMAINDER; files removed=127; bytes removed=128591303
- .next-backup-ui-server: CLEANED_PROTECTED_REMAINDER; files removed=133; bytes removed=134300517
- .next-build: CLEANED_PROTECTED_REMAINDER; files removed=4399; bytes removed=412113786
- .next-cal: DELETED; files removed=372; bytes removed=177985258
- .next-desktop-agent-check: CLEANED_PROTECTED_REMAINDER; files removed=9792; bytes removed=421858031
- .next-live: DELETED; files removed=310; bytes removed=226529204
- .next-p2: DELETED; files removed=382; bytes removed=145269346
- .next-qa: DELETED; files removed=356; bytes removed=454333017
- .next-qa-e2e: DELETED; files removed=249; bytes removed=377396571
- .next-qa-e2e-final: DELETED; files removed=419; bytes removed=395629873
- .next-qa-web: DELETED; files removed=186; bytes removed=173153972
- .next-rep: DELETED; files removed=324; bytes removed=172581915
- .next-rule: DELETED; files removed=146; bytes removed=141904158
- .next-search: DELETED; files removed=303; bytes removed=177011725
- .next-shots: DELETED; files removed=330; bytes removed=230644757
- .next-sqlite-core-check: CLEANED_PROTECTED_REMAINDER; files removed=4801; bytes removed=345868296
- playwright-report: DELETED; files removed=1; bytes removed=593352
- test-results: DELETED; files removed=2; bytes removed=90168
- src-tauri/target: CLEANED_PROTECTED_REMAINDER; files removed=80; bytes removed=22657422

## Final verification
- Follow-up total: 29616 files; 8412236634 bytes removed across three productive executions.
- Including the earlier 159 logs: 29775 files; 8415120587 bytes removed (logical lengths).
- 31 candidate directories completely deleted; 7 directories cleaned with protected descendant subtrees and their ancestors retained. These are deliberate protected remainders, not complete directory deletions.
- Metadata-only final listing confirms only six protected-remainder `.next-*` directories remain; `src-tauri/target` likewise retains protected descendants. Default `.next` remains untouched. Playwright/test reports are absent.
- One refusal remains: `tsconfig.tsbuildinfo` changed during inventory verification; it remains untouched by cleanup. No retry against this concurrently written file was attempted.
- No processes terminated, branch switches, commits, or Git mutations. Application code, root data/backups/private-data/secrets, releases, dependencies, documentation and screenshots were not cleanup targets.
- Final script retains conservative refusal for unknown runtimes; the temporary external-runtime fallback used during execution was removed. External helper identity or installed-app path is required, or an already-exited process is ignored.

Reuse: `powershell -NoProfile -File scripts/cleanup-workspace.ps1` (dry-run); add `-Execute` to delete. Reports reflect the latest run; historical pass totals above are fixed evidence for this cleanup, not an automatic cross-run ledger.
Safety: exact allowlist; canonical workspace containment; inspected ancestors/descendants checked for reparse points; tracked content refused; directories must be ignored; protected descendant subtrees and their ancestors retained without content inspection; candidate/repository process references and ambiguous runtimes refused; explicitly identified external Codex/OpenCode/MCP helpers and installed RealEstateCRM runtime ignored; exclusive file-open probe; inventory rechecked before deletion. No recursive deletion. Concurrent filesystem changes cannot be fully fenced: do not run alongside artifact writers. Partial removals are counted on failure.

## Reusable script follow-up

The execution evidence above is preserved. The coordinator then removed hardcoded
historical counters and external report destinations, required ignored status for
files as well as directories, and used native attribute lookups with full parent
paths. Empty retained trees are handled without a strict-mode aggregate error.
Dry-run prints its plan and leaves the previous execution report unchanged.
Windows PowerShell dry-run: eight candidates, one cache file, zero refusals and
zero deletions; report SHA-256 unchanged. No additional execute pass was run.
