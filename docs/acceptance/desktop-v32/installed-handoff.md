# Installed synthetic handoff / conflict acceptance

## Scope and safety contract

`scripts/desktop/test-installed-handoff.ps1` is an opt-in PowerShell 7.2+ Windows
x64 installed-product API harness. It does not build, install, uninstall, use Git,
read workbooks, load `.env`, access cloud credentials, or use customer profiles.
The installed EXE supplied for this task is the old `7e7e47e` build: normal GUI is
known broken; smoke/API results **must not be reported as normal UI proof**.

Only a nonexistent direct child `data/qa-v32-handoff-<full lowercase GUID>` is
accepted. Source A, recipient B and divergent C are freshly created under it;
only this invocation's A is reopened for the return leg. Ancestors are checked
for reparse points, and the new root ACL grants only the current user and SYSTEM.
Inherited application environment is cleared. Each launcher receives private
LOCALAPPDATA, APPDATA and TEMP paths. Existing application processes or the writer
mutex block launch; the harness never signals `--shutdown` or kills by PID/name.
Teardown uses only the retained launcher Process handle and its child tree. This
is forced **synthetic test teardown**, not graceful-close acceptance. No existing
customer state is copied, removed, restored or inspected.

Generated login password, archive phrase and recovery key remain in harness
memory only, never arguments, reports or response dumps. The installed product
may persist its own DPAPI-protected secret references under these synthetic
profiles as part of the real backup workflow. Do not enable transcripts,
debuggers, PowerShell step tracing or HTTP tracing. Retained outputs are synthetic
profiles, encrypted archives, a synthetic attachment and safe aggregate JSON.

## Invocation

Run from the workspace in a private, non-transcribed PS7 session, when no CRM is
running and the coordinator is not replacing the installed files:

```powershell
$run = Join-Path $PWD ('data\qa-v32-handoff-' + [guid]::NewGuid().ToString())
pwsh -NoProfile -File scripts/desktop/test-installed-handoff.ps1 `
  -InstallDirectory "$env:LOCALAPPDATA\Programs\RealEstateCRM" `
  -RunRoot $run -RunInstalledHandoff
```

No shared Next build directories or new dependencies are used. No USB or native
picker replay is required: a real supported local backup destination under the
new run root transports the real encrypted backup archives. A smoke launcher has
a bounded 300-second lifetime; startup and operation waits are also bounded.

## Executable checks (not a mirror of the handoff implementation)

1. Verify runtime metadata belongs to the launched EXE's bundled Node supervisor
   and its server child before requests; restrict URL to `127.0.0.1` without
   redirects. Complete empty setup through installed API and log in.
2. Create a synthetic client and text attachment. Download and hash the attachment.
   Disable scheduled/on-close backups and configure only an owned local target.
3. A `give`: await supervisor result and replacement server, verify read-only
   result, real transported archive size/SHA-256 and its transport manifest.
   Authenticated direct PATCH must return HTTP 503 / `INSTANCE_READ_ONLY`; reread
   must show unchanged name and `updatedAt`.
4. Stop only A's owned tree. Fresh B verifies the archive with recovery key,
   receives it with phrase, checks restored client and attachment checksum,
   unchanged local installation/device identity, and `compare=same`. B edits
   the client and gives a real successor snapshot, then proves standby denial.
5. Reopen owned A, confirm standby denial, and attempt the actual return `receive`
   through the installed API. If the standby route blocks it, record
   `RETURN_RECEIVE_BLOCKED_BY_STANDBY_GUARD`; never edit handoff JSON, reset role,
   submit a command file, or substitute ordinary rollback `restore`. A future
   installed build that queues it must restore B's edit and attachment.
6. Fresh C receives the original snapshot and edits its own copy through API.
   Compare the successor snapshot: require `conflict`. Receive must fail with
   `TRANSFER_REVISION_CONFLICT`. Confirm unchanged local name/`updatedAt`, restored
   attachment checksum, and both transported archive checksums still intact.

The conflict test uses two genuine business edits and genuine encrypted backups;
it never supplies fabricated manifests or calls internal handoff functions. The
record/file checks do not establish byte-for-byte invariance of every DB table.
It checks both original transport archives, not a claim that the installed
coordinator creates a separate conflict-folder archive of each divergent copy.

## Result semantics and missing gates

`safe-report.json` records only fixed check codes, booleans, archive hashes/sizes,
EXE SHA-256, timestamp and outcome. Exit 0 requires all paths including return
handoff to pass; BLOCKED/FAIL exit 1. Startup/API/command failure retains a stage
gate rather than emitting exception/response content. Partial successful checks
are not an overall PASS. A preflight rejection creates no report/profile.

Source review found `give` sets standby in `desktop-coordinator.ts` and supervisor
reloads that role, while `settings/backups/control/route.ts` has no standby
exception to `api-handler.ts`'s mutation guard. Thus returning ownership may be
blocked before `receive` can run. The harness records the actual installed result
instead of silently working around this. A supported authenticated standby
receive/promote pathway is a missing product gate if this occurs.

Normal GUI, actual native picker, multi-PC identity/DPAPI portability, graceful
shutdown, offline fencing, cloud replication, all-table preservation, and human
UAT are explicitly outside this harness's proof. No claim of T08/T11 completion
follows from a partial run.

## Execution evidence

Bounded installed run completed all stages with overall **BLOCKED** (exit 1).
The only gate was `RETURN_RECEIVE_BLOCKED_BY_STANDBY_GUARD`. A→B receive,
recovery-key archive verification, attachment restoration, installation/device
identity retention, `compare=same`, standby direct-mutation denial, divergent C
`compare=conflict` / receive rejection, and record/file preservation checks passed.
Both real transport archives remained hash-valid (1,849,203 and 1,849,237 bytes).
Evidence: `data/qa-v32-handoff-4f1c305f-80b8-4472-978f-0b45c20885c9/safe-report.json`.
Installed EXE SHA-256:
`45f8b7be3038919e679a93cad97b1b4a4b0018001d0005feb1905076ecf2c977`.
Aggregate completion timestamp: `2026-11-06T23:32:19.2312202Z` (host UTC).
PowerShell AST parsing passed before execution. No normal GUI proof was attempted.

See `D:/crm-review/installed-handoff.md` for the bounded run's exact aggregate
result, evidence directory, parsing check and limitations. No full build or
shared test suite is part of this task.

## Source correction awaiting installed retest

 The manager control route admits schema-validated archive listing, native picker,
 native result/export, credentialed verify/compare and confirmed receive on
 supervised desktop standby. Native file receive uses the existing one-shot,
 actor-bound import capability and queues `receive`, not ordinary rollback.
 Create, give, ordinary restore, retry and settings changes remain forbidden.
 The UI exposes these recovery choices and labels the read-only state. A known clean/dirty snapshot returns `same`/`local_changed` without
restoring, switching generation, or clearing standby. Ordinary explicit restore
keeps its rollback semantics. Empty first adoption remains supported; existing
foreign-deployment and divergent states are rejected.

 Earlier coordinator verification: TypeScript and ESLint passed; 66 targeted tests passed
across six files, including 13 real synthetic SQLite/archive runtime cases and
30 HTTP/application guard cases. These checks do not change the old installed
 BLOCKED result above. A rebuilt EXE must rerun this harness.

The current source additionally passed 39 focused guard/runtime tests and ESLint
on the changed source/test files. These tests use synthetic data and do not prove
the installed GUI, native picker, cloud transports or a human USB round trip. The
installed handoff and normal manager UI gate remains pending on a rebuilt product.
