import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { CODEBOOK_COLUMNS, checkConstraintName, codesOf } from "@/shared/codebook";

const root = "prisma/sqlite/migrations";
const target = "20261109010000_ai_chat_context_codebook";
const migrations = readdirSync(root).filter(name => /^\d/.test(name)).sort();
const sql = (name: string) => readFileSync(join(root, name, "migration.sql"), "utf8");

describe.each([true, false])("populated SQLite context migration (transaction=%s)", wrapped => {
  it.each(["20261106130000_desktop_core", "20261109003000_ai_screen_context"])("preserves history from %s", from => {
    const db = new Database(":memory:");
    try {
      db.pragma("foreign_keys=ON");
      for (const name of migrations.filter(name => name <= from)) db.exec(sql(name));
      db.exec(`INSERT INTO users(id,login,display_name,role_code,password_hash,updated_at) VALUES('u','synthetic','Test','manager','synthetic',0);
        INSERT INTO ai_chat_sessions(id,owner_user_id,title,context_type,updated_at) VALUES('s','u','Synthetic','none',123);
        INSERT INTO ai_pending_actions(id,session_id,action_type,payload) VALUES('a','s','task','{"title":"Synthetic"}');
        INSERT INTO ai_chat_messages(id,session_id,role,content,pending_action_id) VALUES('m','s','assistant','Synthetic','a');`);
      const history = () => ["ai_chat_sessions", "ai_chat_messages", "ai_pending_actions"].map(table => db.prepare(`SELECT * FROM ${table}`).all());
      const schema = () => db.prepare("SELECT type,name,sql FROM sqlite_master WHERE tbl_name IN ('ai_chat_sessions','ai_chat_messages','ai_pending_actions') AND type IN ('index','trigger') ORDER BY type,name").all();
      const before = history(), beforeSchema = schema();
      expect(beforeSchema.filter(row => (row as { type: string }).type === "trigger")).toEqual([]);
      expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
      // The new migration also upgrades the original four-context table directly.
      if (wrapped) db.transaction(() => db.exec(sql(target)))(); else db.exec(sql(target));
      expect(history()).toEqual(before);
      expect(schema()).toEqual(beforeSchema);
      expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(db.pragma("defer_foreign_keys", { simple: true })).toBe(0);
      expect(db.pragma("foreign_key_check")).toEqual([]);
      expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
      for (const kind of codesOf("aiChatContextType")) {
        const id = ["none", "today", "reports"].includes(kind) ? null : "synthetic-record";
        db.prepare("UPDATE ai_chat_sessions SET context_type=?,context_id=? WHERE id='s'").run(kind, id);
        expect(() => db.prepare("UPDATE ai_chat_sessions SET context_id=? WHERE id='s'").run(id ? null : "invalid")).toThrow(/CHECK/);
      }
      expect(() => db.exec("UPDATE ai_chat_sessions SET context_type='invalid'")).toThrow(/CHECK/);
      expect(() => db.exec("DELETE FROM ai_chat_sessions WHERE id='s'")).toThrow(/FOREIGN KEY/);
      expect(() => db.exec("UPDATE ai_chat_sessions SET owner_user_id='missing'")).toThrow(/FOREIGN KEY/);
      expect(() => db.exec("UPDATE ai_chat_messages SET session_id='missing'")).toThrow(/FOREIGN KEY/);
      expect(() => db.exec("UPDATE ai_pending_actions SET session_id='missing'")).toThrow(/FOREIGN KEY/);
    } finally { db.close(); }
  });
});

it("all SQLite CHECK codebook groups match after the complete migration chain", () => {
  const db = new Database(":memory:");
  try {
    db.pragma("foreign_keys=ON");
    for (const name of migrations) db.transaction(() => db.exec(sql(name)))();
    for (const entry of CODEBOOK_COLUMNS) {
      const table = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(entry.table) as { sql: string };
      const definition = table.sql.split("\n").find(line => line.includes(`CONSTRAINT "${checkConstraintName(entry.table, entry.column)}"`));
      expect(definition, `${entry.table}.${entry.column}`).toBeDefined();
      expect([...definition!.matchAll(/'([^']*)'/g)].map(match => match[1]).sort()).toEqual([...codesOf(entry.book)].sort());
      expect(definition!.includes(`"${entry.column}" IS NULL`)).toBe(!!entry.nullable);
    }
  } finally { db.close(); }
});
