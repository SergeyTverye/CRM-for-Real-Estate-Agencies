import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
it.each([true, false])("populated SQLite settings upgrade, outer transaction=%s", outer => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE ai_settings(id TEXT PRIMARY KEY,browser_enabled BOOLEAN NOT NULL); INSERT INTO ai_settings VALUES('existing',1)");
    const sql = readFileSync("prisma/sqlite/migrations/20261109190000_source_browser_navigation/migration.sql", "utf8");
    if (outer) db.transaction(() => db.exec(sql))(); else db.exec(sql);
    expect(db.prepare("SELECT * FROM ai_settings").get()).toEqual({ id: "existing", browser_enabled: 1, cian_auto_browser: null, yandex_auto_browser: null });
    db.exec("UPDATE ai_settings SET cian_auto_browser=0,yandex_auto_browser=1");
    expect(db.pragma("foreign_key_check")).toEqual([]);
  } finally { db.close(); }
});
