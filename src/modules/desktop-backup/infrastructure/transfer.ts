import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { BackupError, type ArchiveRef, type BackupDestination } from "../domain/contracts";
import { hashFile, protectedDir, regularFile } from "./fs";
export async function assertArchive(file: string, expected: Pick<ArchiveRef, "size" | "sha256">) {
  const s = await regularFile(file);
  if (s.size !== expected.size) throw new BackupError("ARCHIVE_LENGTH");
  if ((await hashFile(file)).sha256 !== expected.sha256) throw new BackupError("ARCHIVE_CHECKSUM");
}
export async function receive(body: ReadableStream<Uint8Array> | null, dest: string, maxBytes: number, signal?: AbortSignal) {
  if (!body) throw new BackupError("EMPTY_RESPONSE"); let bytes = 0;
  const limit = new Transform({ transform(chunk, _encoding, cb) { bytes += chunk.length; cb(bytes > maxBytes ? new BackupError("DOWNLOAD_LIMIT") : null, chunk); } });
  try { await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream), limit, createWriteStream(dest, { flags: "wx", mode: 0o600 }), { signal }); }
  catch (e) { await rm(dest, { force: true }); throw e; }
}
export async function verifyDownload(destination: BackupDestination, archive: ArchiveRef, workRoot: string, signal?: AbortSignal) {
  await protectedDir(workRoot); const dir = await mkdtemp(path.join(workRoot, "verify-"));
  try { const file = path.join(dir, "archive"); await destination.get(archive.backupId, file, signal); await assertArchive(file, archive); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
export function uploadBody(file: string, start?: number, end?: number) {
  return Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
}
export function safeEndpoint(endpoint: string, allowLocalHttp = false) {
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(allowLocalHttp && url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))) throw new BackupError("TLS_REQUIRED");
  return url;
}
