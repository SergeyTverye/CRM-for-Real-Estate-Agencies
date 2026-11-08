# Installed search release `998b59f` — bounded verification (ACCEPTED for search task)

Commit `998b59fa149399506449e3165e7b1bf322a28ecc` (product code `7168b36`; `998b` — test-only fix).
Official CI [42440108843](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42440108843): build + install WinServer22 + install WinServer25 — **ALL SUCCESS**.
Artifact [13601623264](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42440108843/artifacts/13601623264).

## Installed package (verified)

- File `releases/windows-x64/CRM-Setup-Windows-x64.exe`, **800 171 772 bytes**, SHA-256 `dcccfede42424657f7fce3c4b8cac836dd05f35f0e8301ce5e90577dd3698bb3`.
- Official ZIP digest `37647774377351f65a32dc5ca48b0e176aa0776f07bd478aa9c3e52b16f8a56d`.
- Installed launcher SHA-256 `60bf5292982535763c2954bd84f9edb26437ad009d1250ad3bc49547a6b88524`.
- Local Win11 update `2026-11-08T03:10:31.1486441Z` — exit 0, 415 user files unchanged; strict installed runtime allowlist **PASS** (no internal TZ files); no program-resource patches.
- Normal launch using the preserved default Windows profile also returned readiness HTTP 200 with database/storage healthy after connecting the authorized key. The app was left running; no customer records were opened for this check.

## Installed Playwright (verified)

- Run `b09766e8-2b7f-4c9f-a6f4-eddb9b7ef8bd`, completed `03:14:04.521Z`: terminal **PASS 7 parent / 0 fail / 1 business NOTRUN**; result SHA `8cbcf70ee695e5e19e6f952b73e7e7ee8cc243d5740bbacfe26fa3359888cce2`.
- Installed runtime: Node `24.15.0`, SQLite `3.51.2`, Chrome `156.0.8078.4`; supervisor headless, no native WebView.
- Own restart client persisted; no error/cleanup issues; browser external HTTP 0 (not physical offline). Fresh synthetic profile; no real workbook.

## Search UI — 16/16 boolean PASS

Manager/setup/login; 7 source toggles persist across restart; availability inherited, ENV-not-disable; disabling honored; DPAPI key save/replace/remove metadata-only, no exposure; missing key distinct; «Жилая»; advanced filter/counter retain; single «Искать» above fold; primary toggle ARIA-hidden; independent advanced state preserving values; tooltip keyboard/click/Escape.

Screenshots (real, coordinator-captured/visually inspected, synthetic UI only; no AI key forms/screens/live addresses):

- [v32-search-primary.png](../../screenshots/vkr/v32-search-primary.png)
- [v32-search-collapsed.png](../../screenshots/vkr/v32-search-collapsed.png)
- [v32-search-advanced.png](../../screenshots/vkr/v32-search-advanced.png)
- [v32-search-sources-settings.png](../../screenshots/vkr/v32-search-sources-settings.png)

Manifest: [v32-search-evidence.md](../../screenshots/vkr/v32-search-evidence.md) (source: installed SHA/run/provenance).

## Installed LIVE workers — 2/2 OnRealt jobs, 16 persisted

- Office: completed / source success. Housing: partial / source partial (coverage/time bound); positive durable results in both.
- 12 worker flags PASS; AI usage unchanged 0 before AI. No all-site/full-housing coverage guarantee.

## Installed LIVE AI — one synthetic parse, 10/10 PASS

- Synthetic text (apartment, Novosibirsk, 7M, 40 m²): actual provider, valid normalized filters; usageDelta 1, charged 0.0739 RUB, reserved 0, cap 1.
- Key via trusted coordinator callback from authorized ENV; temporary QA credential removed, never printed. Scraper works without AI; no repeated paid calls.
- The previously authorized connection was then saved for the installed default profile, which had no existing AI connection, using Windows DPAPI. Existing user settings and budget were unchanged; the local ciphertext roundtrip passed with zero additional paid calls. A pre-existing connection would have been preserved.

## Installed upgrade and rollback

Separate run `25a5cd34-13bd-429e-a0b4-f97118089ce5`: **7/7 PASS**, error/cleanup null. Verified pending-ledger/queue conflict without business changes, compiled rollback restoring the injected database baseline and document, then healthy installed reupgrade/login/download/version and owned-process teardown. This uses synthetic profiles and the installed compiled modules; program resources were unchanged. Result SHA-256: `264c9ae46bc68dcef4a044a9b419cf5db65282fba163086be08af39e9f8b5974`.

## Boundaries

- Official Windows CI: **1935 unit PASS + 5 skip**, **426 SQLite integration PASS + 1 skip**, Rust 1 PASS, final runtime PASS. Local full PG 400 and SQLite 423 + 1 skip preceded the test-only privacy fix; subsequent focused import PG11/SQLite11 passed. Production PG 9 / SQLite 22 include actual restore.
- Core goal full-DT remains PARTIAL: clean consumer VM blocked by user decision; physical USB/network cut and native picker remain unproven.
- Release accepted for the bounded search task, not the entire goal.
