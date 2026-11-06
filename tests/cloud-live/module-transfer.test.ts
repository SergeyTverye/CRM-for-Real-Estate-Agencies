import { copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ArchiveRef, BackupDestination } from "../../src/modules/desktop-backup/domain/contracts";
import { hashFile } from "../../src/modules/desktop-backup/infrastructure/fs";
import { runModuleTransferRestore, type CloudLiveSecrets } from "./module-transfer";

function memoryDestination(id: string, root: string): BackupDestination {
  const objects = new Map<string, { file: string; archive: ArchiveRef }>();
  return {
    id,
    async put(archive, source) {
      const target = path.join(root, `${id}-${archive.backupId}.blob`);
      await copyFile(source, target); objects.set(archive.backupId, { archive, file: target });
    },
    async list() { return [...objects.values()].map(value => value.archive); },
    async get(backupId, target) { const item = objects.get(backupId); if (!item) throw new Error("NOT_FOUND"); await copyFile(item.file, target); },
    async delete(backupId) { const item = objects.get(backupId); if (item) { await rm(item.file, { force: true }); objects.delete(backupId); } },
    async verify(archive) {
      const item = objects.get(archive.backupId); if (!item) throw new Error("NOT_FOUND");
      const actual = await hashFile(item.file); if (actual.size !== archive.size || actual.sha256 !== archive.sha256) throw new Error("HASH_MISMATCH");
    },
  };
}
describe("MODULE_TRANSFER_RESTORE synthetic exercise", () => {
  it("creates one synthetic archive, exercises both failure paths, reloads queues, downloads and restores twice", async () => {
    const secrets: CloudLiveSecrets = {
      yandex: { bucket: "synthetic-bucket", accessKeyId: "synthetic-access", secretAccessKey: "synthetic-secret" },
      mailru: { email: "synthetic@example.invalid", applicationPassword: "synthetic-app-password" },
    };
    try {
      const result = await runModuleTransferRestore(secrets, ({ root: runRoot }) => ({
        destinations: [memoryDestination("yandex", runRoot), memoryDestination("mailru", runRoot)],
        async probeS3Anonymous() { return { getStatus: 403, listStatus: 403 }; },
        dispose() {},
      }));
      expect(result.stage).toBe("MODULE_TRANSFER_RESTORE");
      expect(result.status).toBe("COMPLETED");
      expect(result.providers).toBe(2);
      expect(result.bytes).toBeGreaterThan(7 * 1024 ** 2);
      expect(result.s3Parts).toBeGreaterThan(1);
      expect(result.mailruChunks).toBeGreaterThan(1);
      expect(result.restoredInstances).toBe(2);
      expect(result.failureModes).toBe(2);
      expect(result.anonymousDenied).toBe(2);
      expect(result.hashesMatch).toBe(true);
    } finally { /* module runner owns and safely removes its mkdtemp root */ }
  }, 120_000);
});
