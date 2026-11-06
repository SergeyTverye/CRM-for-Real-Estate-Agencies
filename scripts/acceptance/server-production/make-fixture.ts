// Генерирует синтетический xlsx-образец (все данные вымышлены) для приёмки server production.
// Использование: node node_modules/tsx/dist/cli.mjs scripts/acceptance/server-production/make-fixture.ts <out.xlsx>
import { writeFileSync } from "node:fs";
import { buildSampleWorkbook } from "../../dev/import-sample-builder";

const out = process.argv[2];
if (!out) throw new Error("укажите путь выходного файла");
writeFileSync(out, await buildSampleWorkbook());
console.log(`fixture written: ${out}`);
