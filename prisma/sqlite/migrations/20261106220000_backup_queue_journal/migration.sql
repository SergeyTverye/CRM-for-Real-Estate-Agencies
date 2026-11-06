-- CreateTable
CREATE TABLE "backup_queue_journals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL
);
