# AI chat context codebook regression

The checkout already contained `20261109003000_ai_screen_context` with nine
database codes, but `CODEBOOK.aiChatContextType` still listed four. Reconcile the
codebook and add `20261109010000_ai_chat_context_codebook` to both migration trees
without changing applied migration checksums.

The PostgreSQL migration replaces both context CHECK constraints. SQLite creates
and populates a replacement table before dropping the original, defers child
foreign keys in desktop transactions, and restores both explicit session indexes.
There are no session triggers to recreate. Messages and pending actions retain
their session references, including the message/action composite foreign key.
Record contexts require an ID; `none`, `today`, and `reports` require no ID.

The schema generator produced no semantic changes to `schema.prisma` or
`compatibility.json`; `constraints.sql` contains manual indexes/triggers, so none
of these files needs an update. The incremental SQL carries the changed CHECKs.

Verification on synthetic data:

- Unit: `codebook-migration`, `ai-screen-context-migration`, and
  `ai-chat-codebook-migration`: 100/100 PASS. Checks cover every codebook group on
  both engines, populated four-code and nine-code SQLite tables with/without a
  transaction starting with foreign keys enabled, unchanged child rows/indexes,
  integrity checks, and rejection of invalid codes/context IDs/foreign keys.
- PostgreSQL `crm_test_h`: `v241-schema`, `ai-chat`, and `ai-screen-context`:
  27/27 PASS. Full migrations applied to the isolated test schema; assistant
  conversations with `deal`, `agreement`, and `task` persist messages and reopen
  through the application service using a fake provider.
- SQLite `integration-sqlite`: the same three integration files plus
  `authorization/ai-chat`: 32/32 PASS, including persisted record contexts and
  the complete codebook constraint comparison.
- `npx tsc --noEmit`, `npx eslint . --max-warnings=0`, staged confidentiality
  guard and `git diff --cached --check`: PASS.

Reproduce with `npx vitest run --project unit` and the three unit files above;
use `--project integration` with `TEST_DATABASE_URL` pointing to the isolated
`crm_test_h` database for PostgreSQL, or `--project integration-sqlite` with the
integration/authorization files above for SQLite. The PG test setup recreates
the test schema. No live AI provider or operational database is used.
