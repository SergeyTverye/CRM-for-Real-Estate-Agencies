-- Add-only AI chat extension; no tables or existing business data are changed.
ALTER TABLE "ai_usage_logs" DROP CONSTRAINT "ai_usage_logs_call_type_check";
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_call_type_check"
CHECK ("call_type" IN ('parse','description','web_search','call_note','offer_text','chat','chat_web'));
