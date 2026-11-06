import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, rename, rm, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { BackupError } from "../domain/contracts";
export const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}";
  return JSON.stringify(value);
}
export async function hashFile(file: string) {
  const hash = createHash("sha256"); let size = 0;
  for await (const chunk of createReadStream(file)) { hash.update(chunk); size += chunk.length; }
  return { size, sha256: hash.digest("hex") };
}
export async function syncDir(dir: string) {
  if (process.platform === "win32") return;
  const h = await open(dir, "r"); try { await h.sync(); } finally { await h.close(); }
}
export async function atomicJson(file: string, value: unknown) {
  const tmp = file + "." + randomUUID() + ".pending"; const h = await open(tmp, "wx", 0o600);
  try { await h.writeFile(canonical(value)); await h.sync(); } finally { await h.close(); }
  try { await rename(tmp, file); await syncDir(path.dirname(file)); } finally { await rm(tmp, { force: true }); }
}
export function safeRelative(input: string) {
  if (input.length > 1024 || /[\\:<>"|?*\x00-\x1f]/.test(input) || input.startsWith("/") || input.split("/").some(s => !s || s === "." || s === ".." || /[. ]$/.test(s) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(s))) throw new BackupError("UNSAFE_PATH");
  return input;
}
export async function assertNoSymlinks(target: string) {
  let current = path.resolve(target);
  for (;;) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new BackupError("SYMLINK_FORBIDDEN"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
}
export async function protectedDir(dir: string) { await assertNoSymlinks(dir); await mkdir(dir, { recursive: true, mode: 0o700 }); }
export async function ensureSpace(dir: string, bytes: number) {
  const info = await statfs(dir, { bigint: true });
  if (info.bavail * info.bsize < BigInt(bytes)) throw new BackupError("INSUFFICIENT_SPACE");
}
export async function regularFile(file: string) {
  await assertNoSymlinks(file); const s = await stat(file);
  if (!s.isFile()) throw new BackupError("REGULAR_FILE_REQUIRED"); return s;
}
