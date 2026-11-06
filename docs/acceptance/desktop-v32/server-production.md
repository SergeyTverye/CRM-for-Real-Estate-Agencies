# CRM v3.2.1 — server production acceptance

## Clean-image rerun — latest bounded server result

**PASS**, actually executed 2026-11-06 21:03:15–21:04:37 UTC (timestamps from runner).
Image `crm-app:v32-clean-11a2778` was already available; no rebuild/install performed.
Coordinator supplied public git archive provenance; independently checked exact image
APP_COMMIT and live runtime APP_COMMIT:
`11a27784bdead108483ca058bfa72179597fb8fe`.
Image SHA: `sha256:965356828d986cddf1f61ffd175e4629b124b0f4e31d9dad2502cbadd2e60d8e`.
Runtime Node **v24.22.2**, PostgreSQL **18.6 (Debian 18.6-1.pgdg12+2)**;
host runner Node v22.23.4. PostgreSQL image SHA unchanged from prior run below.

Exact invocation:

```powershell
node scripts/acceptance/server-production.mjs --image crm-app:v32-clean-11a2778 --expected-commit 11a27784bdead108483ca058bfa72179597fb8fe --provenance "Coordinator supplied: public git archive 11a2778; exact APP_COMMIT verified; existing image, no rebuild by acceptance runner" --project-prefix crm-v32-cleanqa --restore-project-prefix crm-v32-cleanrt --wait-image-seconds 300
```

Runner now accepts `--image`, `--provenance`, exact `--expected-commit`,
`--project-prefix`, `--restore-project-prefix`, and optional `--project-suffix`.
Suffix is appended to both prefixes, permitting fresh isolated reruns without deleting
retained projects. Image availability wait is configurable 0–300 seconds, 15-second
intervals; this image was present on first inspect. Compose still pins the inspected SHA.
No source helper is required inside the clean image: tiny synthetic XLSX is generated
using its installed ExcelJS and backup scripts are already in the image.

All nine prior gate groups below passed again: clean migrations/3-user seed and workers;
three concurrent HTTP sessions; client/task and admin RBAC; protected document/checksum;
synthetic XLSX dry-run/commit (1 imported, 0 errors) and export ZIP; restart persistence;
actual pg_dump/verify; actual isolated pg_restore/files/counts; restored app/workers,
three logins, control records, API file checksum and foreign denial.

New evidence root: `data/qa-v32-prod/2026-11-06T21-03-15-088Z/`:
`result.json` contains actual results and exact executed commands;
`commands.log`, redacted `execution.log`, synthetic export and actual backup retained.
Backup ID `2026-11-06_21-03-54`.
Control client `04480741-eaac-453d-958f-e951f0c72994`;
document `4626bd52-84b8-4210-a71a-2bfefb5eca5d`;
SHA-256 `27851c2517941b0658f46767c3e717bb7514285577ad65810ff3750612a8ef94`.

Projects `crm-v32-cleanqa` / `crm-v32-cleanrt` used new independent PG volumes and
loopback ports 3555/3556. Both stopped, all synthetic evidence/volumes retained.
Every compose command used explicit own env-file; no existing private data or backups
were read. No Git mutation, install, build or prior QA resource deletion.

Initial provenance preflight intentionally failed before creating a compose stack because
the expected short SHA `11a2778` did not equal the full APP_COMMIT; preserved at
`data/qa-v32-prod/2026-11-06T21-03-01-124Z/result.json`. Rerun above uses exact full SHA.
This is not an application defect and was not relabelled as PASS.

External report: `D:/crm-review/v32-server-clean.md`.
**Windows/full DT and full regressions remain outside this gate.** Export content
round-trip, browser and HTTPS/load acceptance are not claimed.
Previous evidence is retained below and at
`data/qa-v32-prod/2026-11-06T20-42-43-909Z/result.json`.

## Prior image run — retained historical evidence

**Result: PASS for the bounded synthetic server gate only.** Executed 2026-11-06,
20:42:43–20:43:59 UTC. This is **not** full desktop/Windows acceptance or a clean-build certification.

## Implementation and execution

```powershell
node scripts/acceptance/server-production.mjs
```

The runner completes the supplied partial `server-production/compose.yaml` setup.
No dependencies installed, image rebuilt, source application modified, or Git mutation performed.
Host orchestration used Node v22.23.4; the actual production application used **Node v24.22.2**.
PostgreSQL reported **18.6 (Debian 18.6-1.pgdg12+2)**.

Images actually used:

- `crm-app:v32-acceptance`: `sha256:6ace13b8dd85e6a915bfc27b587e756f3b653a8d47f0e66a9510f2cfe7bc5b09`
- `postgres:18.6-bookworm`: `sha256:5c4783a8cc3f0074912164f94dfa1be4e043438f0f707cf968d7af9a0d31a2c8`

The app was pinned by SHA in the generated compose environment. Supplied provenance:
image content base `ba8d271`, APP_COMMIT `fb9a792`; these do not establish a clean checkout.

## Results

| Gate | Actual result |
|---|---|
| Fresh PostgreSQL volume, migrations, seed | PASS; exactly 3 synthetic users |
| App + notification worker + search worker | PASS; Compose health checks in both projects |
| Three concurrent HTTP logins | PASS; manager + two realtors, separate sessions, HttpOnly/SameSite=Lax |
| Client/task cross-ID RBAC | PASS; own allowed, foreign denied, manager allowed |
| Import/export manager-only access | PASS; realtor requests denied |
| Protected document | PASS; upload, owner/manager download, foreign/anonymous denial |
| Synthetic XLSX import | PASS; dry-run does not change property count; commit imports 1 row, 0 errors |
| Export | PASS; manager receives ZIP signature; synthetic export retained |
| Restart persistence | PASS; DB row, file SHA-256, existing session and fresh login |
| Actual backup and verification | PASS; pg_dump, files archive, manifest, checksums, штатный verify.sh |
| Actual isolated restore | PASS; pg_restore + file extraction, manifest row counts and file checksums |
| Restored application | PASS; 3 logins, control client/task, downloaded file SHA-256, foreign denial |

Control client: `29168b05-1458-432f-b62d-2af9f4590b1c`.
Control document: `4f7c3335-45ad-4c92-9c84-ed2132dfddcf`.
SHA-256: `1840b9fbb5511b9ea126ed43791c55e2665907d5e4401df8e2569efe7e380b5f`.
Backup: `2026-11-06_20-43-24`.

## Evidence and isolation

Own artifact root:
`data/qa-v32-prod/2026-11-06T20-42-43-909Z/`.

- `result.json`: results, exact executed Docker commands, image SHAs, control identifiers.
- `commands.log`: exact commands (no passwords/session tokens).
- `execution.log`: captured command output with generated secrets redacted.
- `crm-v32-qa/backups/2026-11-06_20-43-24/`: actual backup.
- `crm-v32-qa-restore/backups/2026-11-06_20-43-24/`: restore input copy.
- `crm-v32-qa/synthetic-export.zip`: synthetic export response.

Every compose invocation explicitly supplies `--project-name`, `--env-file <own>/qa.env`
and `-f scripts/acceptance/server-production/compose.yaml`. Bind mounts are exclusively
under this own root. Ports were checked free: `127.0.0.1:3555` and `127.0.0.1:3556`.
No host PostgreSQL port. Separate new PostgreSQL volumes in each project.
Credentials are random, synthetic, retained only in ignored QA environments and never printed.
No private workbook, private-data, existing dotenv/cloud credentials, existing data/backup,
production CRM or `crm-test-testdb-1` was read or operated on.

Public `scripts/restore.sh` and `scripts/restore-test.sh` were inspected but not invoked,
because their host wrappers consult root environment/default stacks. The runner instead
uses existing image scripts `/app/ops/backup/scripts/{backup,verify,restore-data}.sh`
with the isolated compose configuration. Restore really loaded PostgreSQL and files;
`pg_restore --list` was only the preliminary verification, not the restore gate.

## Remaining handles / limitations

Both owned projects **stopped successfully**; containers, networks, volumes and synthetic
artifacts retained for review. No cleanup deletion was performed. The runner refuses to
reuse existing projects/volumes, so another fresh run requires deliberate cleanup of only
these QA resources first. On failure it retains handles and records `FAIL` for investigation.

Windows desktop/installer, HTTPS/Secure-cookie deployment, UI/browser flows, broad workbook
coverage, export ZIP content round-trip and load/performance testing were **not** certified.
Previous PG 356/356 and SQLite 375 PASS / 1 skip are supplied context, not rerun here.
No full DT PASS is claimed. No remaining blocker for this bounded server gate.
