import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DESKTOP_SQLITE_PRAGMAS } from "@/shared/db/sqlite-adapter";
import { db, resetDatabase, seedBase, makeClient, makeNeed, type TestUsers } from "../helpers/fixtures";
import { disconnectDb } from "@/shared/db/client";
import { batchLinksAccessible, listCalendar, needClientMap } from "@/modules/calendar/application/calendar-service";

afterAll(disconnectDb);

const migDir = "prisma/sqlite/migrations";
function filledDb(): { file: string; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), "crm-perf-test-"));
  const file = join(dir, "perf.db");
  const native = new Database(file);
  for (const name of readdirSync(migDir).sort()) {
    try { native.exec(readFileSync(join(migDir, name, "migration.sql"), "utf8")); } catch { /* aux */ }
  }
  for (const p of DESKTOP_SQLITE_PRAGMAS) native.pragma(p);
  native.exec("PRAGMA foreign_keys=OFF");
  native.exec(`INSERT INTO users(id,login,display_name,role_code,password_hash,updated_at) VALUES('u1','r1','R1','realtor','x',0),('u2','r2','R2','realtor','x',0)`);
  const c = native.prepare(`INSERT INTO clients(id,display_name,client_kind,responsible_user_id,status,created_by,updated_at) VALUES(?,?,?,?,?,?,?)`);
  const t = native.prepare(`INSERT INTO tasks(id,responsible_user_id,created_by,task_type,title,due_at,status,priority,completed_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`);
  const e = native.prepare(`INSERT INTO calendar_events(id,start_at,end_at,title,owner_user_id,visibility,client_id,updated_at) VALUES(?,?,?,?,?,?,?,?)`);
  native.transaction(() => {
    for (let i = 0; i < 500; i++) c.run(`c${i}`, `Клиент ${i}`, "person", i % 2 ? "u1" : "u2", "active", "u1", 0);
    for (let i = 0; i < 1000; i++) {
      const st = i % 10 < 8 ? "planned" : "completed";
      t.run(`t${i}`, "u1", "u1", "call_or_contact", `T${i}`, new Date(Date.now() + (i - 500) * 3600000).toISOString(), st, "normal", st === "completed" ? new Date().toISOString() : null, 0);
    }
    for (let i = 0; i < 200; i++) e.run(`e${i}`, new Date(Date.now() + i * 3600000).toISOString(), new Date(Date.now() + (i + 1) * 3600000).toISOString(), `E${i}`, i % 2 ? "u1" : "u2", "private", i % 5 === 0 ? `c${i % 500}` : null, 0);
  })();
  native.exec("PRAGMA foreign_keys=ON");
  return { file, db: native };
}

const SEARCH = (native: Database.Database, sql: string) =>
  native.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => (r as { detail: string }).detail).join(" | ");

describe("desktop perf v3.2.3", () => {
  it("пингует безопасный набор PRAGMA и совместимость с Online Backup API", async () => {
    expect(DESKTOP_SQLITE_PRAGMAS).toEqual([
      "foreign_keys = ON",
      "busy_timeout = 10000",
      "journal_mode = WAL",
      "synchronous = NORMAL",
      "cache_size = -64000",
      "temp_store = MEMORY",
      "mmap_size = 268435456",
    ]);
    const { file, db: native } = filledDb();
    try {
      expect(native.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(native.pragma("synchronous", { simple: true })).toBe(1); // NORMAL
      expect(native.pragma("cache_size", { simple: true })).toBe(-64000);
      expect(native.pragma("temp_store", { simple: true })).toBe(2); // MEMORY (0 default, 1 file, 2 memory)
      expect(native.pragma("mmap_size", { simple: true })).toBe(268435456);
      // Тот же механизм, что использует desktop-координатор: sqlite3_backup.
      const dest = `${file}.backup.db`;
      await native.backup(dest);
      const copy = new Database(dest, { readonly: true });
      try {
        expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
        expect((copy.prepare("SELECT count(*) AS n FROM tasks").get() as { n: number }).n).toBe(1000);
      } finally {
        copy.close();
      }
      rmSync(dest, { force: true });
    } finally {
      native.close();
      rmSync(file, { force: true });
    }
  });

  it("горячие запросы страниц идут по индексам (EXPLAIN QUERY PLAN без SCAN)", () => {
    const { file, db: native } = filledDb();
    try {
      for (const [label, sql] of [
        ["clients-list", `SELECT id FROM clients WHERE responsible_user_id='u1' AND status='active' ORDER BY updated_at DESC LIMIT 20`],
        ["tasks-mine", `SELECT id FROM tasks WHERE responsible_user_id='u1' AND status IN ('planned','in_progress') AND due_at > 0 ORDER BY due_at ASC LIMIT 20`],
        ["today-overdue", `SELECT id FROM tasks WHERE responsible_user_id='u1' AND status IN ('planned','in_progress') AND due_at < 9999999999999 LIMIT 200`],
        ["calendar-range", `SELECT id FROM calendar_events WHERE archivedAt IS NULL AND start_at < '2999-01-01' LIMIT 1001`],
      ] as const) {
        const plan = SEARCH(native, sql.replace("archivedAt", "archived_at"));
        expect(plan, label).toMatch(/SEARCH/);
        expect(plan, label).not.toMatch(/SCAN/);
      }
    } finally {
      native.close();
      rmSync(file, { force: true });
    }
  });

  it("подстроковый поиск по имени осознанно остаётся SCAN (LIKE '%…%' не покрывается B-tree)", () => {
    const { file, db: native } = filledDb();
    try {
      const plan = SEARCH(native, `SELECT id FROM clients WHERE display_name LIKE '%Клиент 1%' LIMIT 20`);
      expect(plan).toMatch(/SCAN/);
    } finally {
      native.close();
      rmSync(file, { force: true });
    }
  });
});

describe("batched calendar access (N+1 fix)", () => {
  let users: TestUsers;
  beforeEach(async () => { await resetDatabase(); users = await seedBase(); });

  it("batchLinksAccessible совпадает с поштучными проверками и не раскрывает чужое", async () => {
    const mine = await makeClient(users.realtor1);
    const stranger = await makeClient(users.realtor2);
    const items = [
      { clientId: mine.id },
      { clientId: stranger.id },
      { clientId: "00000000-0000-0000-0000-000000000000" },
      {},
    ];
    expect(await batchLinksAccessible(db, users.realtor1, items)).toEqual([true, false, false, true]);
    expect(await batchLinksAccessible(db, users.manager, items)).toEqual([true, true, false, true]);
  });

  it("needClientMap различает потребности клиентов без запросов в цикле", async () => {
    const c = await makeClient(users.realtor1);
    const need = await makeNeed(users.realtor1, c.id);
    const map = await needClientMap(db, [{ id: "e1", needId: need.id }, { id: "e2", needId: null }, { id: "e3", needId: "00000000-0000-0000-0000-000000000000" }]);
    expect(map.get("e1")).toBe(c.id);
    expect(map.get("e2")).toBeNull();
    expect(map.get("e3")).toBeNull();
  });

  it("listCalendar с фильтром по клиенту не раскрывает чужую приватную встречу", async () => {
    const c = await makeClient(users.realtor1);
    const start = new Date(Date.now() + 3600000).toISOString();
    const end = new Date(Date.now() + 7200000).toISOString();
    await db.calendarEvent.create({ data: { title: "Своя", startAt: new Date(start), endAt: new Date(end), ownerUserId: users.realtor1.userId, visibility: "private", clientId: c.id } });
    await db.calendarEvent.create({ data: { title: "Чужая", startAt: new Date(start), endAt: new Date(end), ownerUserId: users.realtor2.userId, visibility: "private", clientId: c.id } });
    const range = { from: new Date(Date.now()).toISOString(), to: new Date(Date.now() + 86400000).toISOString(), clientId: c.id };
    const own = await listCalendar(users.realtor1, range, { now: new Date() });
    expect(own.some((i) => i.title === "Чужая")).toBe(false);
    const mgr = await listCalendar(users.manager, range, { now: new Date() });
    expect(mgr.some((i) => i.title === "Чужая")).toBe(false); // приватная — только занятость/проекция
  });
});
