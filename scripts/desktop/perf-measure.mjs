


import Database from "better-sqlite3";
import { readdirSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migDir = join(root, "prisma", "sqlite", "migrations");

export const PRAGMA_BASE = ["foreign_keys = ON", "busy_timeout = 10000", "journal_mode = WAL"];
export const PRAGMA_TUNED = [
  ...PRAGMA_BASE,
  "synchronous = NORMAL",
  "cache_size = -64000",
  "temp_store = MEMORY",
  "mmap_size = 268435456",
];

function openFilled(pragmas) {
  const db = new Database(mkdtempSync(join(tmpdir(), "crm-perf-")) + "/bench.db");
  for (const name of readdirSync(migDir).sort()) {
    try { db.exec(readFileSync(join(migDir, name, "migration.sql"), "utf8")); } catch {  }
  }
  for (const p of pragmas) db.exec(`PRAGMA ${p}`);
  db.exec("PRAGMA foreign_keys=OFF");
  db.exec(`INSERT INTO users(id,login,display_name,role_code,password_hash,updated_at) VALUES('u1','r1','Риелтор 1','realtor','x',0),('u2','m1','Менеджер','manager','x',0)`);
  const c = db.prepare(`INSERT INTO clients(id,display_name,client_kind,responsible_user_id,status,created_by,updated_at) VALUES(?,?,?,?,?,?,?)`);
  const t = db.prepare(`INSERT INTO tasks(id,responsible_user_id,created_by,task_type,title,due_at,status,priority,completed_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`);
  const e = db.prepare(`INSERT INTO calendar_events(id,start_at,end_at,title,owner_user_id,visibility,client_id,need_id,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`);
  const tc = db.prepare(`INSERT INTO task_clients(task_id,client_id) VALUES(?,?)`);
  const now = Date.now();
  const insC = db.transaction(() => {
    for (let i = 0; i < 2000; i++) c.run(`c${i}`, `Клиент ${i}`, "person", i % 2 ? "u1" : "u2", "active", "u1", now - i);
    for (let i = 0; i < 5000; i++) {
      const st = i % 10 < 6 ? "planned" : i % 10 < 8 ? "in_progress" : "completed";
      const done = st === "completed" ? new Date(now).toISOString() : null;
      t.run(`t${i}`, i % 2 ? "u1" : "u2", "u1", i % 50 === 0 ? "showing_or_meeting" : "call_or_contact", `Задача ${i}`,
        new Date(now + (i - 2500) * 3600000).toISOString(), st, "normal", done, now - i);
      if (i % 3 === 0) tc.run(`t${i}`, `c${i % 2000}`);
    }
    for (let i = 0; i < 1000; i++) {
      e.run(`e${i}`, new Date(now + i * 3600000).toISOString(), new Date(now + (i + 1) * 3600000).toISOString(),
        `Встреча ${i}`, i % 2 ? "u1" : "u2", i % 5 === 0 ? "public" : "private",
        i % 4 === 0 ? `c${i % 2000}` : null, null, now - i);
    }
  });
  insC();
  db.exec("PRAGMA foreign_keys=ON");
  return db;
}

function plan(db, label, sql) {
  const rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all();
  const detail = rows.map((r) => r.detail).join(" | ");
  const scan = /SCAN(?!.*USING.*INDEX|.*USING COVERING INDEX)/.test(detail) && !/USING INDEX/.test(detail) ? "SCAN!" : "indexed";
  console.log(`[${label}] ${scan}: ${detail}`);
  return scan;
}

const db = openFilled(PRAGMA_BASE);
console.log("== PRAGMA (base) ==");
for (const k of ["journal_mode", "synchronous", "cache_size", "temp_store", "mmap_size", "busy_timeout", "foreign_keys"])
  console.log(`  ${k} = ${db.pragma(k, { simple: true })}`);

console.log("== EXPLAIN QUERY PLAN (filled: 2000 clients / 5000 tasks / 1000 events) ==");
const verdicts = [
  plan(db, "clients-list", `SELECT id FROM clients WHERE responsible_user_id='u1' AND status='active' ORDER BY updated_at DESC LIMIT 20`),
  plan(db, "clients-search", `SELECT id FROM clients WHERE display_name LIKE '%Клиент 1%' LIMIT 20`),
  plan(db, "tasks-mine", `SELECT id FROM tasks WHERE responsible_user_id='u1' AND status IN ('planned','in_progress') AND due_at >= 0 ORDER BY due_at ASC LIMIT 20`),
  plan(db, "tasks-all-status", `SELECT id FROM tasks WHERE status IN ('planned','in_progress') ORDER BY due_at ASC LIMIT 20`),
  plan(db, "today-overdue", `SELECT id FROM tasks WHERE responsible_user_id='u1' AND status IN ('planned','in_progress') AND due_at < 9999999999999 ORDER BY due_at ASC LIMIT 200`),
  plan(db, "calendar-range", `SELECT id FROM calendar_events WHERE archived_at IS NULL AND start_at < '2999-01-01' AND (end_at > '2000-01-01' OR recurrence_rule IS NOT NULL) LIMIT 1001`),
  plan(db, "calendar-owner", `SELECT id FROM calendar_events WHERE owner_user_id='u1' AND start_at < '2999-01-01' LIMIT 100`),
  plan(db, "task-clients-join", `SELECT t.id FROM tasks t JOIN task_clients tc ON tc.task_id=t.id WHERE tc.client_id='c5' AND t.status IN ('planned','in_progress') LIMIT 20`),
];
db.close();

console.log("== microbench: base vs tuned PRAGMA (file DB, 2000 inserts + 2000 indexed selects) ==");
function bench(pragmas) {
  const d = new Database(mkdtempSync(join(tmpdir(), "crm-perf-")) + "/bench.db");
  for (const name of readdirSync(migDir).sort()) {
    try { d.exec(readFileSync(join(migDir, name, "migration.sql"), "utf8")); } catch {  }
  }
  for (const p of pragmas) d.exec(`PRAGMA ${p}`);
  d.exec("PRAGMA foreign_keys=OFF");
  d.exec(`INSERT INTO users(id,login,display_name,role_code,password_hash,updated_at) VALUES('u1','r1','R','realtor','x',0)`);
  const ins = d.prepare(`INSERT INTO tasks(id,responsible_user_id,created_by,task_type,title,due_at,status,priority,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`);
  const sel = d.prepare(`SELECT id FROM tasks WHERE responsible_user_id=? AND status IN ('planned','in_progress') ORDER BY due_at LIMIT 20`);
  const t0 = performance.now();
  const tx = d.transaction(() => { for (let i = 0; i < 2000; i++) ins.run(`b${i}`, "u1", "u1", "call_or_contact", `B ${i}`, new Date(Date.now() + i * 60000).toISOString(), "planned", "normal", Date.now()); });
  tx();
  const t1 = performance.now();
  for (let i = 0; i < 2000; i++) sel.all("u1");
  const t2 = performance.now();
  const wal = d.pragma("journal_mode", { simple: true });
  d.close();
  return { writeMs: Math.round(t1 - t0), readMs: Math.round(t2 - t1), wal };
}
const a = bench(PRAGMA_BASE);
const b = bench(PRAGMA_TUNED);
console.log(`  base : write ${a.writeMs}ms read ${a.readMs}ms (journal=${a.wal})`);
console.log(`  tuned: write ${b.writeMs}ms read ${b.readMs}ms (journal=${b.wal})`);
const gain = (x, y) => (x > 0 ? Math.round((1 - y / x) * 100) : 0);
console.log(`  delta: write ${gain(a.writeMs, b.writeMs)}% read ${gain(a.readMs, b.readMs)}%`);

console.log("== FullCalendar client weight (node_modules source, pre-bundle proxy) ==");
let total = 0;
for (const p of ["core", "react", "daygrid", "timegrid", "list", "interaction"]) {
  const dir = join(root, "node_modules", "@fullcalendar", p);
  const out = spawnSync(process.execPath, ["-e", `const fs=require('fs'),p=require('path');let s=0;const w=d=>{for(const f of fs.readdirSync(d,{withFileTypes:true})){const j=p.join(d,f.name);if(f.isDirectory())w(j);else if(/\\.js$/.test(f.name))s+=fs.statSync(j).size}};w(${JSON.stringify(dir)});console.log(s)`], { encoding: "utf8" });
  const kb = Math.round(Number(out.stdout.trim()) / 1024);
  total += kb;
  console.log(`  @fullcalendar/${p}: ~${kb} KB js`);
}
console.log(`  total FullCalendar js in route bundle (static import): ~${total} KB pre-minify`);

console.log("== cold start supervisor->ready: component breakdown (code-level, standalone not built) ==");
const n0 = spawnSync(process.execPath, ["-e", ""], { encoding: "utf8" });
void n0;
const tNode = (() => { const s = performance.now(); spawnSync(process.execPath, ["-e", ""]); return Math.round(performance.now() - s); })();
console.log(`  node -e "" spawn: ~${tNode}ms (baseline interpretатора)`);
console.log(`  supervisor stages: freePort + spawn server.js (Next standalone, parses ~MB js) + migrate/upgrade + waitReady poll 300ms (avg detection lag ~150ms) + spawn 3 workers + runtime.json`);
console.log(`  waitReady: deadline 120s, poll 300ms; READY logged only after first 200 OK /api/health/ready (DB+storage checks)`);
console.log(`  graceful.cjs preload: trivial (stdin handler, <1ms); better-sqlite3 native load happens in server process, not supervisor`);
const scans = verdicts.filter((v) => v.startsWith("SCAN")).length;
console.log(`== verdict: ${scans} SCAN without index / ${verdicts.length} hot queries ==`);
