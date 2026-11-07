# Isolated synthetic dual regression

Run from the repository with a Node executable matching the already-installed native modules:

```powershell
& 'D:/runtimes/nodejs/node.exe' scripts/tests/run-synthetic-regression.mjs 'D:/chrome-win64/chrome.exe'
```

No installation, rebuild, dotenv, Prisma CLI or full application build is performed. Native SQLite/Argon2 loading is preflighted. The current installed SQLite binary requires Node 22 ABI 127; this is not Node 24 release certification.

The runner snapshots source hashes and HEAD without Git commands, creates unique evidence paths and an owned temporary root, then synchronously awaits PostgreSQL and SQLite sequentially. Child environments contain only allowlisted OS execution settings and explicit synthetic settings; home/AppData/temp point into the owned root. Only a UUID database on the test loopback PostgreSQL endpoint is created/dropped. PostgreSQL applies versioned migration SQL directly, **not Prisma deploy**. SQLite uses the existing actual migration/template global setup and per-file setup.

All integration/authorization cases are included; SQLite also includes tests/sqlite. Exactly the two cases in private-workbook-verifier.test.ts are excluded because they write private-data. Real Chrome is selected by a call-through launch spy; rendering/navigation is not stubbed. Existing test assertions and conditional server-only skips are unchanged.

The custom reporter persists only closed states, counts, durations, file/index references and error classes/source locations. Child stdout/stderr are discarded; raw assertions/payloads are never saved. Evidence includes the exact collected files and per-case results. No retries are added. Cleanup checks browser-profile counts before deleting the owned temp root; PG teardown checks database absence. Source changes during execution invalidate stable-snapshot/clean-commit claims even if tests pass.
