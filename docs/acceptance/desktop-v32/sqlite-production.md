# Current production SQLite acceptance

2026-11-07 — **22 PASS / 0 FAIL**, terminal exit 0.

Source `278b54f0cbc003a1c87e492e0851b73ec93ba60d`; APP_VERSION `3.2.1`.
Image `crm-app:v32-clean-278b54f`: `sha256:6b7e74e253117858af9585f8be33a2f7d1033bb76897c9d28a6ef3917554bd17`.
Same genuine clean-public-archive image as PostgreSQL acceptance. Native Linux Node 24.22.2 / SQLite; no PostgreSQL in this suite.

PASS: image identity; clean SQLite migration; readiness; first manager setup via API; realtor temporary-password change and admin/archive/anonymous denial; client; call; need with next task; calendar; property; collection; collection-to-offer; DOCX generation/download; PDF rendering; XLSX export; open ZIP export; foreign-client/document denial; artifact structures/synthetic content; SQLite integrity/counts/file checksums; restart persistence/login; encrypted generic archive/actual restore; restored readiness/login/client/document.

SQLite integrity `ok`, zero foreign-key errors, one document checksum verified. Counts: 2 users, 1 client, 1 communication, 1 need, 1 task, 1 property, 1 collection, 1 offer, 1 document; 2 migration ledger entries.

Encrypted backup ID `2faea7b8-09ad-4b36-a581-8da3fe0482ba`, 1860445 bytes; SHA256 `81d398fcfd7076fd5f6cfdcb94e284af9a95489a40ea761a75abe345eb61790e`. Manifest SHA256 `92aac38b78f743cd84efe89480b69d1bd5c630b8a0f9ffa7dfe070b54d978a1a`.

Evidence: `data/qa-v32-sqliteprod/2026-11-07T16-50-52-177Z/results.json`; SHA256 `d7be200cde7e882a26402253db59aee3b052d08d546107beaf7295ad794f412c`.
Container `crm-v32-sqliteqa-aabcc608`, loopback 3567; internal network `crm-v32-sqliteqa-2026-11-07t16-50-52-177z`. Final container verified stopped; fixtures/backups/restored DB/files retained.

## Reproduction and limits

Exact commands and full provenance: `data/coordination/production-current.md`. Use a fresh suffix; conflicts refused. Desktop initialization scripts mounted read-only from exact archived public source. No host install/rebuild, private workbook, real account, root dotenv, cloud or existing CRM used.

This is the existing bounded client/call/need/task/calendar/property/collection/offer/documents/export/restart/encrypted-restore cycle, not every CRM workflow, complete T01–T10 or full Desktop gates. SQLite has two users; server suite separately checked three concurrent users. DOCX/XLSX synthetic content and PDF signature/EOF/hash checked, not visual PDF layout. HTTP uses docker exec within an internal network; Windows-host browser access unverified. Existing readiness deploymentMode label is not backend proof; native SQLite files/migrations/integrity were checked. No Windows launcher/installer/native picker/supervisor/DPAPI/cloud compatibility claim. Encryption keys remain in memory, not saved; restored DB/files retained for inspection. AI/scraper/search/cloud targets disabled.
