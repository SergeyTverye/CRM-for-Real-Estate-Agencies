import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildSampleWorkbook } from "./import-sample-builder";


const out = path.resolve("data/import-samples/sample-workbook.xlsx");
mkdirSync(path.dirname(out), { recursive: true });
buildSampleWorkbook().then((buf) => {
  writeFileSync(out, buf);
  console.log(`Создан ${out} (${buf.length} байт)`);
});
