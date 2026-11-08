-- Rebuild only documents to extend its CHECK; preserve all rows, links and indexes.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE documents_type_backup AS SELECT * FROM documents;
DROP TABLE documents;
CREATE TABLE "documents" (
    "template_version_id" TEXT,
    "values_snapshot" JSONB,
    "thumbnail_storage_key" TEXT,
    "id" TEXT NOT NULL PRIMARY KEY,
    "original_name" TEXT NOT NULL,
    "document_type_code" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" BIGINT NOT NULL,
    "storage_provider" TEXT NOT NULL DEFAULT 'local',
    "storage_key" TEXT NOT NULL,
    "checksum" TEXT,
    "uploaded_by" TEXT NOT NULL,
    "legal_entity_id" TEXT,
    "archived_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    CONSTRAINT "documents_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "document_template_versions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "documents_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "documents_document_type_code_check" CHECK ("document_type_code" IN ('agreement', 'agreement_addendum', 'agreement_attachment', 'title_document', 'commercial_offer', 'act', 'invoice', 'photo', 'other')),
    CONSTRAINT "documents_file_size_check" CHECK ("file_size" >= 0)
);
INSERT INTO documents SELECT * FROM documents_type_backup;
DROP TABLE documents_type_backup;
CREATE UNIQUE INDEX "documents_storage_key_key" ON "documents"("storage_key");
CREATE INDEX "documents_template_version_id_idx" ON "documents"("template_version_id");
CREATE INDEX "documents_uploaded_by_idx" ON "documents"("uploaded_by");
CREATE INDEX "documents_legal_entity_id_idx" ON "documents"("legal_entity_id");
CREATE TRIGGER documents_clear_archived_cover AFTER UPDATE OF archived_at ON documents WHEN NEW.archived_at IS NOT NULL AND OLD.archived_at IS NOT NEW.archived_at
BEGIN UPDATE document_properties SET is_cover=false WHERE document_id=NEW.id AND is_cover; END;
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
