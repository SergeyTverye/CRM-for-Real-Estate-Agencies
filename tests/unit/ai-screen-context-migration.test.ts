import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { it, expect } from "vitest";
for (const wrapped of [true, false]) it(`AI context migration preserves populated SQLite with transaction=${wrapped}`, () => {
 const db = new Database(":memory:");
 try {
  db.exec(readFileSync("prisma/sqlite/migrations/20261106130000_desktop_core/migration.sql", "utf8"));
  db.exec(`PRAGMA foreign_keys=ON;
   INSERT INTO users(id,login,display_name,role_code,password_hash,updated_at) VALUES('u','test','Test','manager','synthetic',0);
   INSERT INTO ai_chat_sessions(id,owner_user_id,title,context_type,updated_at) VALUES('s','u','Test','none',0);
   INSERT INTO ai_chat_messages(id,session_id,role,content) VALUES('m','s','user','synthetic');
   INSERT INTO ai_pending_actions(id,session_id,action_type,payload) VALUES('a','s','task','{}');`);
  const sql = readFileSync("prisma/sqlite/migrations/20261109003000_ai_screen_context/migration.sql", "utf8");
  if(wrapped) db.transaction(() => db.exec(sql))(); else db.exec(sql);
  expect(db.prepare("SELECT content FROM ai_chat_messages WHERE id='m'").get()).toEqual({content:"synthetic"});
  expect(db.prepare("SELECT session_id FROM ai_pending_actions WHERE id='a'").get()).toEqual({session_id:"s"});
  expect(db.pragma("foreign_key_check")).toEqual([]);
  expect(db.pragma("foreign_keys", {simple:true})).toBe(1);
  expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ai_chat_sessions'").all()).toHaveLength(3);
  db.exec("UPDATE ai_chat_sessions SET context_type='today'; UPDATE ai_chat_sessions SET context_type='task',context_id='t'");
  expect(() => db.exec("UPDATE ai_chat_sessions SET context_type='reports'")).toThrow();
  expect(() => db.exec("UPDATE ai_chat_sessions SET context_type='unknown'")).toThrow();
 } finally { db.close(); }
});
