import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { BackupError, DEFAULT_LIMITS, manifestSchema, safeSettingsSchema, type ArchiveLimits, type ArchiveRef, type BackupManifest, type BackupMetadata, type SafeSettings, type SnapshotBarrier, type SnapshotSource, type SnapshotValidator } from "../domain/contracts";
import { assertNoSymlinks, canonical, ensureSpace, hashFile, protectedDir, regularFile, safeRelative, sha256, syncDir } from "./fs";
import { CHUNK_BYTES, createHeader, cryptChunk, headerSchema, openHeader, type Header } from "./encryption";
const MAGIC = Buffer.from("CRMBKP1\n");
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
export type Credential = { passphrase: string } | { recoveryKey: string };
async function exact(h: FileHandle, size: number) {
  const b = Buffer.alloc(size); let offset = 0;
  while (offset < size) { const r = await h.read(b, offset, size - offset, null); if (!r.bytesRead) throw new BackupError("TRUNCATED_ARCHIVE"); offset += r.bytesRead; }
  return b;
}
async function* decrypted(h: FileHandle, header: Header, key: Buffer, limits: ArchiveLimits) {
  let total = 0;
  for (let index = 0; ; index++) {
    const length = (await exact(h, 4)).readUInt32BE();
    if (length > CHUNK_BYTES) throw new BackupError("CHUNK_LIMIT");
    total += length; if (total > limits.totalBytes + limits.manifestBytes + 4) throw new BackupError("TOTAL_SIZE_LIMIT");
    const encrypted = await exact(h, length); const tag = await exact(h, 16);
    const plain = cryptChunk(header, key, index, encrypted, length === 0, tag).data;
    if (!length) { const tail = Buffer.alloc(1); if ((await h.read(tail, 0, 1, null)).bytesRead) throw new BackupError("TRAILING_DATA"); return; }
    yield plain;
  }
}
class PlainReader {
  private buffer: Buffer = Buffer.alloc(0);
  constructor(private readonly iterator: AsyncIterator<Buffer>) {}
  async read(length: number) {
    const out = Buffer.alloc(length); let offset = 0;
    while (offset < length) {
      if (!this.buffer.length) { const next = await this.iterator.next(); if (next.done) throw new BackupError("TRUNCATED_PAYLOAD"); this.buffer = next.value; }
      const n = Math.min(length - offset, this.buffer.length); this.buffer.copy(out, offset, 0, n); this.buffer = this.buffer.subarray(n); offset += n;
    }
    return out;
  }
  async finish() { if (this.buffer.length || !(await this.iterator.next()).done) throw new BackupError("EXTRA_PAYLOAD"); }
}
export function validateManifest(input: unknown, limits: ArchiveLimits = DEFAULT_LIMITS): BackupManifest {
  const m = manifestSchema.parse(input); const { manifestSha256, ...unsigned } = m;
  if (sha256(canonical(unsigned)) !== manifestSha256) throw new BackupError("MANIFEST_CHECKSUM");
  if (m.files.length > limits.files) throw new BackupError("FILE_COUNT_LIMIT");
  let total = 0; const seen = new Set<string>();
  for (const file of m.files) {
    safeRelative(file.path);
    if (file.path !== "database.sqlite" && file.path !== "settings.json" && !/^(documents|photos|templates)\//.test(file.path)) throw new BackupError("UNKNOWN_COMPONENT");
    const normalized = file.path.normalize("NFC").toLowerCase();
    if (seen.has(normalized)) throw new BackupError("DUPLICATE_PATH"); seen.add(normalized);
    if (file.size > limits.fileBytes) throw new BackupError("FILE_SIZE_LIMIT");
    total += file.size; if (!Number.isSafeInteger(total) || total > limits.totalBytes) throw new BackupError("TOTAL_SIZE_LIMIT");
  }
  if (!seen.has("database.sqlite") || !seen.has("settings.json")) throw new BackupError("MISSING_COMPONENT");
  const settings = m.files.find(f => f.path === "settings.json")!;
  if (settings.size > 65536) throw new BackupError("SETTINGS_SIZE_LIMIT");
  const expected = new Set(["sqlite", "settings", ...m.files.filter(f => f.path.includes("/")).map(f => f.path.split("/")[0]!)]);
  if (new Set(m.components).size !== m.components.length || [...expected].some(c => !m.components.includes(c as BackupManifest["components"][number]))) throw new BackupError("COMPONENT_MISMATCH");
  for (const item of seen) { const parts = item.split("/"); for (let i = 1; i < parts.length; i++) if (seen.has(parts.slice(0, i).join("/"))) throw new BackupError("PATH_COLLISION"); }
  return m;
}
export async function extractArchive(input: {
  archivePath: string; stagingRoot: string; credential: Credential; validator: SnapshotValidator;
  schemaVersion: number; limits?: ArchiveLimits;
}) {
  const limits = input.limits ?? DEFAULT_LIMITS;
  if ((await regularFile(input.archivePath)).size > limits.archiveBytes) throw new BackupError("ARCHIVE_SIZE_LIMIT");
  await protectedDir(input.stagingRoot);
  const stage = await mkdtemp(path.join(input.stagingRoot, "restore-"));
  const h = await open(input.archivePath, "r"); let key: Buffer | undefined;
  try {
    if (!(await exact(h, MAGIC.length)).equals(MAGIC)) throw new BackupError("UNSUPPORTED_FORMAT");
    const headerLength = (await exact(h, 4)).readUInt32BE();
    if (headerLength > 8192) throw new BackupError("HEADER_SIZE_LIMIT");
    const header = headerSchema.parse(JSON.parse((await exact(h, headerLength)).toString("utf8")));
    key = await openHeader(header, input.credential);
    const reader = new PlainReader(decrypted(h, header, key, limits)[Symbol.asyncIterator]());
    const length = (await reader.read(4)).readUInt32BE(); if (length > limits.manifestBytes) throw new BackupError("MANIFEST_SIZE_LIMIT");
    const manifest = validateManifest(JSON.parse((await reader.read(length)).toString("utf8")), limits);
    if (canonical(manifest.encryption) !== canonical(header.encryption)) throw new BackupError("HEADER_MISMATCH");
    if (manifest.schemaVersion > input.schemaVersion) throw new BackupError("SCHEMA_TOO_NEW");
    await ensureSpace(stage, manifest.files.reduce((n, f) => n + f.size, 0));
    for (const file of manifest.files) {
      const target = path.join(stage, file.path); await protectedDir(path.dirname(target));
      const output = await open(target, "wx", 0o600); const hash = createHash("sha256");
      try {
        let remaining = file.size;
        while (remaining) { const data = await reader.read(Math.min(CHUNK_BYTES, remaining)); hash.update(data); await output.writeFile(data); remaining -= data.length; }
        await output.sync();
      } finally { await output.close(); }
      if (hash.digest("hex") !== file.sha256) throw new BackupError("FILE_CHECKSUM");
    }
    await reader.finish(); // Authenticate final sentinel: prevents truncation at a chunk boundary.
    safeSettingsSchema.parse(JSON.parse(await readFile(path.join(stage, "settings.json"), "utf8")));
    await input.validator.validate(path.join(stage, "database.sqlite"));
    return { manifest, stage, dispose: () => rm(stage, { recursive: true, force: true }) };
  } catch (e) { await rm(stage, { recursive: true, force: true }); throw e; }
  finally { key?.fill(0); await h.close(); }
}
async function copyTree(source: string, dest: string, prefix: string, entries: BackupManifest["files"], limits: ArchiveLimits) {
  await protectedDir(dest);
  for (const item of await readdir(source, { withFileTypes: true })) {
    const relative = safeRelative(prefix + "/" + item.name); const from = path.join(source, item.name); const to = path.join(dest, item.name);
    if (item.isSymbolicLink()) throw new BackupError("SYMLINK_FORBIDDEN");
    if (item.isDirectory()) await copyTree(from, to, relative, entries, limits);
    else {
      const info = await regularFile(from); if (info.size > limits.fileBytes) throw new BackupError("FILE_SIZE_LIMIT");
      if (entries.length >= limits.files) throw new BackupError("FILE_COUNT_LIMIT");
      if (entries.reduce((n, f) => n + f.size, 0) + info.size > limits.totalBytes) throw new BackupError("TOTAL_SIZE_LIMIT");
      await ensureSpace(dest, info.size); await copyFile(from, to); entries.push({ path: relative, ...await hashFile(to) });
    }
  }
}
async function* payload(stage: string, manifest: BackupManifest) {
  const data = Buffer.from(canonical(manifest)); yield u32(data.length); yield data;
  for (const file of manifest.files) for await (const chunk of createReadStream(path.join(stage, file.path), { highWaterMark: CHUNK_BYTES })) yield chunk as Buffer;
}
async function writeEncrypted(file: string, stage: string, manifest: BackupManifest, header: Header, key: Buffer) {
  const h = await open(file, "wx", 0o600);
  try {
    const hdr = Buffer.from(canonical(header)); await h.writeFile(Buffer.concat([MAGIC, u32(hdr.length), hdr]));
    let index = 0;
    for await (const data of payload(stage, manifest)) {
      for (let offset = 0; offset < data.length; offset += CHUNK_BYTES) {
        const chunk = cryptChunk(header, key, index++, data.subarray(offset, offset + CHUNK_BYTES), false);
        await h.writeFile(Buffer.concat([u32(chunk.data.length), chunk.data, chunk.tag]));
      }
    }
    const final = cryptChunk(header, key, index, Buffer.alloc(0), true); await h.writeFile(Buffer.concat([u32(0), final.tag])); await h.sync();
  } finally { await h.close(); }
}
export interface CreateArchiveInput {
  outputDir: string; stagingRoot: string; source: SnapshotSource; barrier: SnapshotBarrier; validator: SnapshotValidator;
  metadata: BackupMetadata | (() => Promise<BackupMetadata>); passphrase: string; recoveryKey: string; recoveryKeySaved: true;
  settings: SafeSettings; storage: Partial<Record<"documents" | "photos" | "templates", string>>; limits?: ArchiveLimits;
  localBudget?: { maxArchives: number; maxBytes: number };
}
export async function createArchive(input: CreateArchiveInput): Promise<{ manifest: BackupManifest; archive: ArchiveRef; path: string }> {
  if (input.recoveryKeySaved !== true) throw new BackupError("RECOVERY_CONFIRMATION_REQUIRED");
  const limits = input.limits ?? DEFAULT_LIMITS; const settings = safeSettingsSchema.parse(input.settings);
  await protectedDir(input.stagingRoot); await protectedDir(input.outputDir);
  const stage = await mkdtemp(path.join(input.stagingRoot, "build-")); const backupId = randomUUID();
  const target = path.join(input.outputDir, backupId + ".crmbackup"); const pending = target + ".pending";
  let key: Buffer | undefined;
  try {
    const encryption = await createHeader(input.passphrase, input.recoveryKey); key = encryption.key; const header = encryption.header;
    const files: BackupManifest["files"] = [];
    let metadata: BackupMetadata | undefined;
    await input.barrier.run(async () => {
      metadata = typeof input.metadata === "function" ? await input.metadata() : input.metadata;
      await input.source.createConsistentSnapshot(path.join(stage, "database.sqlite"));
      await regularFile(path.join(stage, "database.sqlite"));
      files.push({ path: "database.sqlite", ...await hashFile(path.join(stage, "database.sqlite")) });
      for (const component of ["documents", "photos", "templates"] as const) {
        const source = input.storage[component]; if (source) { await assertNoSymlinks(source); await copyTree(source, path.join(stage, component), component, files, limits); }
      }
      await writeFile(path.join(stage, "settings.json"), canonical(settings), { flag: "wx", mode: 0o600 });
      files.push({ path: "settings.json", ...await hashFile(path.join(stage, "settings.json")) });
    });
    if (!metadata) throw new BackupError("SNAPSHOT_METADATA_REQUIRED");
    await input.validator.validate(path.join(stage, "database.sqlite"));
    const now = new Date().toISOString();
    const unsigned = { ...metadata, backupId, formatVersion: 1 as const, createdAtUtc: now, components: ["sqlite", "settings", ...Object.keys(input.storage)] as BackupManifest["components"], files, encryption: header.encryption, kind: "full" as const, verification: { files: "sha256" as const, snapshot: "integrity-and-foreign-keys" as const, verifiedAtUtc: now } };
    const manifest = validateManifest({ ...unsigned, manifestSha256: sha256(canonical(unsigned)) }, limits);
    if (Buffer.byteLength(canonical(manifest)) > limits.manifestBytes) throw new BackupError("MANIFEST_SIZE_LIMIT");
    const budget = input.localBudget ?? { maxArchives: 50, maxBytes: 20 * 1024 ** 3 };
    if (!Number.isSafeInteger(budget.maxArchives) || budget.maxArchives < 1 || !Number.isSafeInteger(budget.maxBytes) || budget.maxBytes < 1) throw new BackupError("LOCAL_BUDGET_INVALID");
    const existing = (await readdir(input.outputDir)).filter(n => n.endsWith(".crmbackup"));
    let existingBytes = 0; for (const name of existing) { const p = path.join(input.outputDir, name); await assertNoSymlinks(p); existingBytes += (await stat(p)).size; }
    const payloadBytes = files.reduce((n, f) => n + f.size, 0);
    if (existing.length >= budget.maxArchives || existingBytes + payloadBytes > budget.maxBytes) throw new BackupError("LOCAL_BACKUP_CAPACITY");
    await ensureSpace(input.outputDir, payloadBytes + limits.manifestBytes);
    await writeEncrypted(pending, stage, manifest, header, key);
    if (existingBytes + (await stat(pending)).size > budget.maxBytes) throw new BackupError("LOCAL_BACKUP_CAPACITY");
    const checked = await extractArchive({ archivePath: pending, stagingRoot: input.stagingRoot, credential: { passphrase: input.passphrase }, validator: input.validator, schemaVersion: metadata.schemaVersion, limits });
    await checked.dispose(); await rename(pending, target); await syncDir(input.outputDir);
    return { manifest, archive: { backupId, createdAtUtc: now, ...await hashFile(target) }, path: target };
  } finally { key?.fill(0); await rm(pending, { force: true }); await rm(stage, { recursive: true, force: true }); }
}
