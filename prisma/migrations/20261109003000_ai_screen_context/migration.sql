ALTER TABLE "ai_chat_sessions" DROP CONSTRAINT "ai_chat_sessions_context_type_check";
ALTER TABLE "ai_chat_sessions" DROP CONSTRAINT "ai_chat_sessions_context_check";
ALTER TABLE "ai_chat_sessions" ADD CONSTRAINT "ai_chat_sessions_context_type_check" CHECK ("context_type" IN ('client', 'need', 'collection', 'task', 'deal', 'agreement', 'today', 'reports', 'none'));
ALTER TABLE "ai_chat_sessions" ADD CONSTRAINT "ai_chat_sessions_context_check" CHECK (("context_type" IN ('none', 'today', 'reports') AND "context_id" IS NULL) OR ("context_type" NOT IN ('none', 'today', 'reports') AND "context_id" IS NOT NULL));
