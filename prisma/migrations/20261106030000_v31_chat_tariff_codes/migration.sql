-- Prisma migrate diff (schema -> same schema) has no DSL changes.
-- CHECK constraints are SQL-only: align tariffs with the v3.1 stable call-type codebook.
BEGIN;
ALTER TABLE "ai_tariffs" DROP CONSTRAINT "ai_tariffs_call_type_check";
ALTER TABLE "ai_tariffs" ADD CONSTRAINT "ai_tariffs_call_type_check"
CHECK ("call_type" IN ('parse','description','web_search','call_note','offer_text','chat','chat_web'));
COMMIT;
