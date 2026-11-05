-- Prisma migrate diff reports no structural changes: codebook CHECK-only extension.
ALTER TABLE "ai_usage_logs" DROP CONSTRAINT "ai_usage_logs_call_type_check";
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_call_type_check" CHECK ("call_type" IN ('parse','description','web_search','call_note','offer_text'));
ALTER TABLE "ai_tariffs" DROP CONSTRAINT "ai_tariffs_call_type_check";
ALTER TABLE "ai_tariffs" ADD CONSTRAINT "ai_tariffs_call_type_check" CHECK ("call_type" IN ('parse','description','web_search','call_note','offer_text'));
