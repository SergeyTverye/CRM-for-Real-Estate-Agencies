# Current production server acceptance

2026-11-07 — **9 PASS / 0 FAIL**, terminal exit 0.

Exact source `278b54f0cbc003a1c87e492e0851b73ec93ba60d`, clean public Git archive build, APP_VERSION `3.2.1`.

Image `crm-app:v32-clean-278b54f`: `sha256:6b7e74e253117858af9585f8be33a2f7d1033bb76897c9d28a6ef3917554bd17`.

Runtime Linux Node v24.22.2 / PostgreSQL 18.6.

- PASS full clean migrations, seed of three synthetic users, app/workers health.
- PASS concurrent three-user sessions, roles, HttpOnly/SameSite cookies.
- PASS cross-client/task RBAC and manager-only endpoints.
- PASS protected documents and file SHA256.
- PASS synthetic XLSX dry-run without operational writes, commit and ZIP export.
- PASS restart persistence, existing session and fresh login.
- PASS actual pg_dump, files archive, manifest/checksums and verify.
- PASS isolated pg_restore/files restore, manifest row counts/checksums.
- PASS restored app/workers, three logins, control records/file SHA256 and RBAC.

Evidence: `data/qa-v32-prod/2026-11-07T16-49-32-773Z/result.json`.
Backup: `2026-11-07_16-50-11`. Control file SHA256: `7616ae41dd722219255291af026375b53acce34def0c21835fb9a62c639f5755`.

Owned projects `crm-v32-finalqa-aabcc608` / `crm-v32-finalrt-aabcc608`, loopback 3555/3556, verified stopped. Volumes/files retained; no existing CRM touched.

Exact commands, archive/evidence hashes, resource inventory and limitations: `data/coordination/production-current.md`. This is bounded synthetic production acceptance, not complete T01–T10, Desktop gates or Windows acceptance.
