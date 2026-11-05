// Offline restore verification: original template bytes + manifest, and generated files.
import { createHash } from "node:crypto";
import { db, disconnectDb } from "@/shared/db/client";
import { getStorage } from "@/shared/storage/storage-adapter";

async function main() {
  const versions = await db.documentTemplateVersion.findMany();
  let files = 0;
  for (const version of versions) {
    const hash = createHash("sha256").update(version.manifestYaml);
    if (version.storageKey) {
      const { stream } = await getStorage().read(version.storageKey);
      for await (const chunk of stream) hash.update(chunk);
      files++;
    } else hash.update(version.markdownBody ?? "");
    if (hash.digest("hex") !== version.checksum) throw new Error("TEMPLATE_CHECKSUM_MISMATCH");
  }
  const generated = await db.document.count({ where: { templateVersionId: { not: null } } });
  console.log(JSON.stringify({ versions: versions.length, templateFiles: files, generatedDocuments: generated }));
}
main().catch(() => { console.error("ops.template_restore_verification_failed"); process.exitCode = 1; }).finally(disconnectDb);
