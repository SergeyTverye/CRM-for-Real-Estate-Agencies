-- v3.2.2: distinct types for agreement addenda and attachments.
ALTER TABLE "documents" DROP CONSTRAINT "documents_document_type_code_check";
ALTER TABLE "documents" ADD CONSTRAINT "documents_document_type_code_check" CHECK ("document_type_code" IN ('agreement', 'agreement_addendum', 'agreement_attachment', 'title_document', 'commercial_offer', 'act', 'invoice', 'photo', 'other'));
