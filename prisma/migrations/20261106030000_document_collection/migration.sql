-- CreateTable
CREATE TABLE "document_collections" (
    "document_id" UUID NOT NULL,
    "collection_id" UUID NOT NULL,

    CONSTRAINT "document_collections_pkey" PRIMARY KEY ("document_id","collection_id")
);

-- CreateIndex
CREATE INDEX "document_collections_collection_id_idx" ON "document_collections"("collection_id");

-- AddForeignKey
ALTER TABLE "document_collections" ADD CONSTRAINT "document_collections_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_collections" ADD CONSTRAINT "document_collections_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "property_collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
