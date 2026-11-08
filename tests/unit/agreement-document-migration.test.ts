import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { expect, it } from "vitest";

it("обновление SQLite сохраняет документы, ссылки, индексы и триггер архива", () => {
  const db = new Database(":memory:");
  try {
    db.exec(readFileSync("prisma/sqlite/migrations/20261106130000_desktop_core/migration.sql", "utf8"));
    db.exec(`PRAGMA foreign_keys=OFF;
      INSERT INTO users(id,login,display_name,role_code,password_hash,updated_at) VALUES('u','test','Test','manager','synthetic',0);
      INSERT INTO documents(id,original_name,document_type_code,mime_type,file_size,storage_key,uploaded_by) VALUES('d','test.pdf','agreement','application/pdf',4,'key','u');
      INSERT INTO clients(id,display_name,client_kind,responsible_user_id,status,created_by,updated_at) VALUES('c','Test','person','u','active','u',0);
      INSERT INTO document_clients VALUES('d','c'); PRAGMA foreign_keys=ON;`);
    db.transaction(() => db.exec(readFileSync("prisma/sqlite/migrations/20261108190000_agreement_document_types/migration.sql", "utf8")))();
    expect(db.prepare("SELECT original_name FROM documents WHERE id='d'").get()).toEqual({ original_name: "test.pdf" });
    expect(db.prepare("SELECT document_id FROM document_clients").get()).toEqual({ document_id: "d" });
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='documents_clear_archived_cover'").get()).toBeTruthy();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='documents_storage_key_key'").get()).toBeTruthy();
    db.exec("UPDATE documents SET document_type_code='agreement_addendum' WHERE id='d'");
    db.exec("UPDATE documents SET document_type_code='agreement_attachment' WHERE id='d'");
    expect(() => db.exec("UPDATE documents SET document_type_code='invalid' WHERE id='d'")).toThrow();
  } finally { db.close(); }
});

it("обновление SQLite без внешней транзакции (prisma migrate deploy) не нарушает внешние ключи", () => {
  const db = new Database(":memory:");
  try {
    db.exec(readFileSync("prisma/sqlite/migrations/20261106130000_desktop_core/migration.sql", "utf8"));
    db.exec(`PRAGMA foreign_keys=OFF;
      INSERT INTO users(id,login,display_name,role_code,password_hash,updated_at) VALUES('u','test','Test','manager','synthetic',0);
      INSERT INTO documents(id,original_name,document_type_code,mime_type,file_size,storage_key,uploaded_by) VALUES('d','test.pdf','agreement','application/pdf',4,'key','u');
      INSERT INTO clients(id,display_name,client_kind,responsible_user_id,status,created_by,updated_at) VALUES('c','Test','person','u','active','u',0);
      INSERT INTO document_clients VALUES('d','c'); PRAGMA foreign_keys=ON;`);
    db.exec(readFileSync("prisma/sqlite/migrations/20261108190000_agreement_document_types/migration.sql", "utf8"));
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.prepare("SELECT document_id FROM document_clients").get()).toEqual({ document_id: "d" });
  } finally { db.close(); }
});
