import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { archiveRefSchema } from "../domain/contracts";
import { planRetention, type RetentionPolicy, type RetainedBackup } from "../domain/retention";
import { DatabaseReplicationJournal } from "../infrastructure/database-journal";
import { hashFile, regularFile } from "../infrastructure/fs";
/** Unknown/incomplete files and snapshots awaiting any destination are never swept. */
export async function pruneLocalPortable(root: string, policy: RetentionPolicy) {
  const { rows } = await new DatabaseReplicationJournal().read();
  const catalog: RetainedBackup[] = [];
  for (const file of await readdir(root).catch(() => [])) {
    if (!/^[a-f0-9-]{36}\.crmbackup\.json$/.test(file)) continue;
    try {
      await regularFile(path.join(root, file));
      const { archive } = JSON.parse(await readFile(path.join(root, file), "utf8"));
      const ref = archiveRefSchema.parse(archive);
      const archiveFile = path.join(root, ref.backupId + ".crmbackup");
      await regularFile(archiveFile);
      const actual = await hashFile(archiveFile);
      if (actual.sha256 !== ref.sha256 || actual.size !== ref.size) continue;
      catalog.push({ ...ref, recoverable: true });
    } catch { /* Invalid metadata requires manual diagnosis, never automatic deletion. */ }
  }
  const plan = planRetention(catalog, { ...policy, minRecoverable: 2 });
  for (const id of plan.deleteIds) {
    if (rows.some(r => r.archive.backupId === id && r.status !== "verified")) continue;
    const file = path.join(root, id + ".crmbackup"); await regularFile(file);
    await rm(file); await rm(file + ".json", { force: true });
  }
  return plan;
}
