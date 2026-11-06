import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashFile } from "@/modules/desktop-backup/infrastructure/fs";
import { importNativeArchive, nativeArchiveUsage, nativeIncomingRoot, withNativeArchiveBudget } from "@/modules/desktop-backup/application/native-dialog";

const fake = vi.hoisted(() => ({ maxBytes: 100, backupId: "", dispose: vi.fn(), extract: vi.fn() }));
vi.mock("@/modules/desktop-backup/infrastructure/settings-repository", () => ({ JsonSettingsRepository: class { async read() { return { retention: { maxBytes: fake.maxBytes } }; } } }));
vi.mock("@/modules/desktop-backup/infrastructure/archive", () => ({ extractArchive: fake.extract }));
vi.mock("@/modules/desktop-backup/infrastructure/sqlite-validator", () => ({ SqliteSnapshotValidator: class {} }));
vi.mock("@/modules/desktop-backup/infrastructure/destinations-runtime", () => ({ backupRuntimeRoot: () => process.env.BACKUP_SETTINGS_DIR! }));
let temp: string, output: string;
const actor = "synthetic-manager";
beforeEach(async () => {
  temp = await mkdtemp("D:/TEMP/UserTEMP/opencode/native-budget-");
  output = path.join(temp, "archives"); await mkdir(output);
  vi.stubEnv("BACKUP_SETTINGS_DIR", path.join(temp, "runtime"));
  fake.maxBytes = 100; fake.backupId = randomUUID(); fake.dispose.mockReset(); fake.extract.mockReset();
  fake.extract.mockImplementation(async () => ({ manifest: { backupId: fake.backupId, components: ["sqlite"], createdAtUtc: new Date().toISOString() }, dispose: fake.dispose }));
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(temp, { recursive: true, force: true }); });
async function staged() {
  const id = randomUUID(), dir = path.join(nativeIncomingRoot(), id); await mkdir(dir, { recursive: true });
  const file = path.join(dir, "archive.crmbackup"); await writeFile(file, "synthetic!");
  await writeFile(path.join(dir, "metadata.json"), JSON.stringify({ actorUserId: actor, expiresAt: Date.now() + 60000, ...await hashFile(file) }));
  return id;
}
const run = (id: string) => importNativeArchive(id, actor, { passphrase: "synthetic-only" }, output);
describe("bounded native archive publication (synthetic files only)", () => {
  it("caps successful imports before extraction, including repeated queue-failure leftovers", async () => {
    for (let i = 0; i < 4; i++) { fake.backupId = randomUUID(); await run(await staged()); }
    await expect(run(await staged())).rejects.toThrow("IMPORT_CAPACITY");
    expect(fake.extract).toHaveBeenCalledTimes(4);
    expect((await nativeArchiveUsage(output)).imports).toBe(4);
    expect(await readdir(nativeIncomingRoot())).toEqual([]);
  });
  it("counts ordinary archives and aggregate native/ordinary pending bytes", async () => {
    await writeFile(path.join(output, "ordinary.crmbackup"), Buffer.alloc(40));
    await writeFile(path.join(output, "one.native.pending"), Buffer.alloc(30));
    await writeFile(path.join(output, "two.crmbackup.pending"), Buffer.alloc(21));
    expect(await nativeArchiveUsage(output)).toEqual({ bytes: 91, pendingBytes: 51, imports: 1 });
    await expect(run(await staged())).rejects.toThrow("IMPORT_CAPACITY");
    expect(fake.extract).not.toHaveBeenCalled();
  });
  it("counts abandoned native pending reservations toward the four-import cap", async () => {
    for (let i = 0; i < 4; i++) await writeFile(path.join(output, randomUUID() + ".native.pending"), "x");
    await expect(run(await staged())).rejects.toThrow("IMPORT_CAPACITY");
    expect(fake.extract).not.toHaveBeenCalled();
    expect(await readdir(output)).toHaveLength(4);
  });
  it.each([".crmbackup", ".crmbackup.import.json", ".crmbackup.json"])("never replaces an existing %s or removes an unowned input", async suffix => {
    const file = path.join(output, fake.backupId + suffix); await writeFile(file, "keep");
    await expect(run(await staged())).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("keep");
    expect((await readdir(output)).filter(n => n.endsWith(".pending"))).toEqual([]);
  });
  it("leaves imported input out of ordinary retention and holds it through protective work", async () => {
    await run(await staged()); const file = path.join(output, fake.backupId + ".crmbackup");
    await withNativeArchiveBudget(output, async () => {
      expect(await readFile(file, "utf8")).toBe("synthetic!");
      await expect(withNativeArchiveBudget(output, async () => undefined)).rejects.toMatchObject({ code: "EEXIST" });
      expect(await readFile(file + ".import.json", "utf8")).toContain(fake.backupId);
    });
    await expect(readFile(file + ".json")).rejects.toMatchObject({ code: "ENOENT" });
    expect(fake.dispose).toHaveBeenCalledOnce();
  });
  it("preserves published restore input after failed protective work and releases only its lock", async () => {
    await run(await staged()); const file = path.join(output, fake.backupId + ".crmbackup");
    await expect(withNativeArchiveBudget(output, async () => { throw Error("synthetic protective failure"); })).rejects.toThrow("synthetic protective failure");
    expect(await readFile(file, "utf8")).toBe("synthetic!");
    expect(await readFile(file + ".import.json", "utf8")).toContain(fake.backupId);
    await withNativeArchiveBudget(output, async () => undefined);
  });
  it("cleans validation work and lock on failure without publishing", async () => {
    fake.extract.mockResolvedValueOnce({ manifest: { components: ["postgres"] }, dispose: fake.dispose });
    await expect(run(await staged())).rejects.toThrow("SQLITE_RESTORE_REQUIRED");
    expect(fake.dispose).toHaveBeenCalledOnce();
    expect(await readdir(output)).toEqual([]);
    expect(await readdir(nativeIncomingRoot())).toEqual([]);
  });
  it("does not unlink an unowned pending file on collision", async () => {
    const id = await staged(), pending = path.join(output, id + ".native.pending");
    await writeFile(pending, "keep");
    await expect(run(id)).rejects.toThrow("ARCHIVE_ID_COLLISION");
    expect(await readFile(pending, "utf8")).toBe("keep");
  });
  it("rejects directories and junctions in counted storage paths", async () => {
    const dir = path.join(output, "invalid.crmbackup"); await mkdir(dir);
    await expect(run(await staged())).rejects.toThrow("REGULAR_FILE_REQUIRED");
    await rm(dir, { recursive: true });
    const junction = path.join(temp, "junction"); await symlink(output, junction, "junction");
    await expect(withNativeArchiveBudget(junction, async () => undefined)).rejects.toThrow("SYMLINK_FORBIDDEN");
  });
});
