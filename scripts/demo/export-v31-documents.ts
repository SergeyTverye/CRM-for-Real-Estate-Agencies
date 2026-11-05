import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { db, demoId } from "./context";
import { getStorage } from "@/shared/storage/storage-adapter";
async function main() {
  await mkdir("data/v31-shots/render", { recursive: true });
  const records = [];
  for (const format of ["markdown_docx", "docx", "xlsx", "xlsx_registry"]) {
    const doc = await db.document.findUniqueOrThrow({ where: { id: demoId(`v31:document:${format}`) } });
    const { stream } = await getStorage().read(doc.storageKey);
    const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const data = Buffer.concat(chunks), checksum = createHash("sha256").update(data).digest("hex");
    assert.equal(checksum, doc.checksum);
    const path = `data/v31-shots/render/generated-${format}.${format.includes("xlsx") ? "xlsx" : "docx"}`;
    await writeFile(path, data);
    records.push({ format, path, checksum, size: data.length, templateVersionId: doc.templateVersionId });
  }
  await writeFile("data/v31-shots/render/sources.json", JSON.stringify(records, null, 2)+"\n");
  console.log(`Exported ${records.length} genuine generated files; checksums PASS`);
}
main().catch(() => { console.error("Generated file export failed"); process.exitCode = 1; }).finally(() => db.$disconnect());
