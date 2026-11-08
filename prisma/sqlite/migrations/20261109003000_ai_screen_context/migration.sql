-- Rebuild CHECK constraints preserving existing sessions, child messages, actions and indexes.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE ai_chat_sessions_context_backup AS SELECT * FROM ai_chat_sessions;
DROP TABLE ai_chat_sessions;
CREATE TABLE "ai_chat_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "context_type" TEXT NOT NULL DEFAULT 'none',
    "context_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    "archived_at" DATETIME,
    CONSTRAINT "ai_chat_sessions_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ai_chat_sessions_context_type_check" CHECK ("context_type" IN ('client', 'need', 'collection', 'task', 'deal', 'agreement', 'today', 'reports', 'none')),
    CONSTRAINT "ai_chat_sessions_context_check" CHECK (("context_type" IN ('none', 'today', 'reports') AND "context_id" IS NULL) OR ("context_type" NOT IN ('none', 'today', 'reports') AND "context_id" IS NOT NULL))
);
INSERT INTO ai_chat_sessions SELECT * FROM ai_chat_sessions_context_backup;
DROP TABLE ai_chat_sessions_context_backup;
CREATE INDEX "ai_chat_sessions_owner_user_id_archived_at_updated_at_idx" ON "ai_chat_sessions"("owner_user_id", "archived_at", "updated_at");
CREATE INDEX "ai_chat_sessions_context_type_context_id_idx" ON "ai_chat_sessions"("context_type", "context_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
