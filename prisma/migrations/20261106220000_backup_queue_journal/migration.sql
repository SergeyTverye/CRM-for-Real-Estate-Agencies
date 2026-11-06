-- Add-only: existing server backup tables and migration history are unchanged.
CREATE TABLE "backup_queue_journals" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    CONSTRAINT "backup_queue_journals_pkey" PRIMARY KEY ("id")
);
