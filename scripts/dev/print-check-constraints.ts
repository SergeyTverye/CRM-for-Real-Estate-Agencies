// Печатает SQL CHECK-ограничений системного codebook для вставки в миграцию.
// Использование: npx tsx scripts/dev/print-check-constraints.ts
import { CODEBOOK_COLUMNS, checkConstraintSql } from "../../src/shared/codebook";

for (const entry of CODEBOOK_COLUMNS) console.log(checkConstraintSql(entry));
