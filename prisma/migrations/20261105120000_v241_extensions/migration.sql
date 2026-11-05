BEGIN;
-- AlterTable
ALTER TABLE "legal_entities" ADD COLUMN     "logo_document_id" UUID,
ADD COLUMN     "requisites" TEXT;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "thumbnail_storage_key" TEXT;

-- AlterTable
ALTER TABLE "document_properties" ADD COLUMN     "archived_at" TIMESTAMPTZ(3),
ADD COLUMN     "caption" TEXT,
ADD COLUMN     "is_cover" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'document',
ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "external_listings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source" TEXT NOT NULL,
    "source_listing_id" TEXT,
    "source_unit_id" TEXT,
    "url" TEXT NOT NULL,
    "source_method" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "price_rub" DECIMAL(16,2),
    "price_unit" TEXT NOT NULL,
    "area_m2" DECIMAL(12,2),
    "floor_raw" TEXT,
    "floor_number" INTEGER,
    "purposes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "address" TEXT,
    "district" TEXT,
    "city" TEXT NOT NULL DEFAULT 'Новосибирск',
    "seller_type" TEXT,
    "owner_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "owner_confirmation_method" TEXT,
    "owner_confirmed_at" TIMESTAMPTZ(3),
    "owner_confirmation_source" TEXT,
    "description" TEXT,
    "images" JSONB NOT NULL DEFAULT '[]',
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_price" DECIMAL(16,2),
    "property_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "external_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_listing_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "listing_id" UUID NOT NULL,
    "search_run_id" UUID,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "price_rub" DECIMAL(16,2),
    "normalized" JSONB NOT NULL,

    CONSTRAINT "external_listing_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_listing_verifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "listing_id" UUID NOT NULL,
    "verified_by" UUID NOT NULL,
    "verified_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "availability" TEXT NOT NULL DEFAULT 'unknown',
    "price_confirmed" BOOLEAN,
    "owner_confirmed" BOOLEAN,
    "note" TEXT,
    "next_check_at" TIMESTAMPTZ(3),

    CONSTRAINT "external_listing_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_bookmarks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'study',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "search_bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_selections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "need_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "added_by" UUID NOT NULL,
    "comment" TEXT,
    "review_status" TEXT NOT NULL DEFAULT 'candidate',
    "property_id" UUID,
    "match_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "search_selections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_searches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT 'Новосибирск',
    "filters" JSONB NOT NULL,
    "sources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "need_id" UUID,
    "last_run_at" TIMESTAMPTZ(3),
    "last_successful_run_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "saved_search_id" UUID,
    "need_id" UUID,
    "user_id" UUID NOT NULL,
    "city" TEXT NOT NULL DEFAULT 'Новосибирск',
    "filters" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "web_search_used" BOOLEAN NOT NULL DEFAULT false,
    "fallback_reason" TEXT,

    CONSTRAINT "search_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_run_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "result_count" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "duration_ms" INTEGER,

    CONSTRAINT "search_run_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_run_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "verdict" TEXT NOT NULL,
    "criteria" JSONB NOT NULL DEFAULT '[]',
    "score" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "is_new" BOOLEAN NOT NULL DEFAULT false,
    "price_changed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "search_run_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ai_enabled" BOOLEAN NOT NULL DEFAULT false,
    "scraper_enabled" BOOLEAN NOT NULL DEFAULT false,
    "browser_enabled" BOOLEAN NOT NULL DEFAULT true,
    "enabled_sources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "web_search_manual_allowed" BOOLEAN NOT NULL DEFAULT false,
    "web_search_auto_fallback" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT NOT NULL DEFAULT 'aliceai-llm-flash/latest',
    "web_model" TEXT,
    "search_context_size" TEXT NOT NULL DEFAULT 'low',
    "per_user_daily_limit" INTEGER NOT NULL DEFAULT 3,
    "per_job_limit" INTEGER NOT NULL DEFAULT 1,
    "daily_limit" INTEGER NOT NULL DEFAULT 10,
    "monthly_budget_rub" DECIMAL(16,2) NOT NULL DEFAULT 1000,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "call_type" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "search_run_id" UUID,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "web_search_calls" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost_rub" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "actual_cost_rub" DECIMAL(16,2),
    "result" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_ms" INTEGER,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_tariffs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "model" TEXT NOT NULL,
    "call_type" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "price_rub" DECIMAL(16,6) NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_budget_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usage_log_id" UUID,
    "amount_rub" DECIMAL(16,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_budget_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "owner_user_id" UUID NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "recurrence_rule" TEXT,
    "client_id" UUID,
    "need_id" UUID,
    "property_id" UUID,
    "deal_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recipient_user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "trigger_at" TIMESTAMPTZ(3) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "read_at" TIMESTAMPTZ(3),
    "snoozed_until" TIMESTAMPTZ(3),
    "title" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "dedup_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "lead_minutes" INTEGER NOT NULL DEFAULT 15,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_checklist_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deal_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'none',
    "responsible_user_id" UUID NOT NULL,
    "checked_at" TIMESTAMPTZ(3),
    "document_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deal_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "external_listings_property_id_idx" ON "external_listings"("property_id");

-- CreateIndex
CREATE INDEX "external_listings_city_operation_last_seen_at_idx" ON "external_listings"("city", "operation", "last_seen_at");

-- CreateIndex
CREATE INDEX "external_listing_snapshots_listing_id_fetched_at_idx" ON "external_listing_snapshots"("listing_id", "fetched_at");

-- CreateIndex
CREATE INDEX "external_listing_snapshots_search_run_id_idx" ON "external_listing_snapshots"("search_run_id");

-- CreateIndex
CREATE INDEX "external_listing_verifications_listing_id_verified_at_idx" ON "external_listing_verifications"("listing_id", "verified_at");

-- CreateIndex
CREATE INDEX "external_listing_verifications_verified_by_idx" ON "external_listing_verifications"("verified_by");

-- CreateIndex
CREATE INDEX "external_listing_verifications_next_check_at_idx" ON "external_listing_verifications"("next_check_at");

-- CreateIndex
CREATE INDEX "search_bookmarks_listing_id_idx" ON "search_bookmarks"("listing_id");

-- CreateIndex
CREATE UNIQUE INDEX "search_bookmarks_user_id_listing_id_key" ON "search_bookmarks"("user_id", "listing_id");

-- CreateIndex
CREATE INDEX "search_selections_listing_id_idx" ON "search_selections"("listing_id");

-- CreateIndex
CREATE INDEX "search_selections_added_by_idx" ON "search_selections"("added_by");

-- CreateIndex
CREATE INDEX "search_selections_property_id_idx" ON "search_selections"("property_id");

-- CreateIndex
CREATE INDEX "search_selections_match_id_idx" ON "search_selections"("match_id");

-- CreateIndex
CREATE UNIQUE INDEX "search_selections_need_id_listing_id_key" ON "search_selections"("need_id", "listing_id");

-- CreateIndex
CREATE INDEX "saved_searches_owner_user_id_idx" ON "saved_searches"("owner_user_id");

-- CreateIndex
CREATE INDEX "saved_searches_need_id_idx" ON "saved_searches"("need_id");

-- CreateIndex
CREATE INDEX "saved_searches_last_successful_run_id_idx" ON "saved_searches"("last_successful_run_id");

-- CreateIndex
CREATE INDEX "search_runs_saved_search_id_started_at_idx" ON "search_runs"("saved_search_id", "started_at");

-- CreateIndex
CREATE INDEX "search_runs_need_id_idx" ON "search_runs"("need_id");

-- CreateIndex
CREATE INDEX "search_runs_user_id_started_at_idx" ON "search_runs"("user_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "search_run_sources_run_id_source_key" ON "search_run_sources"("run_id", "source");

-- CreateIndex
CREATE INDEX "search_run_results_listing_id_idx" ON "search_run_results"("listing_id");

-- CreateIndex
CREATE INDEX "search_run_results_run_id_verdict_idx" ON "search_run_results"("run_id", "verdict");

-- CreateIndex
CREATE UNIQUE INDEX "search_run_results_run_id_listing_id_key" ON "search_run_results"("run_id", "listing_id");

-- CreateIndex
CREATE INDEX "ai_settings_updated_by_idx" ON "ai_settings"("updated_by");

-- CreateIndex
CREATE INDEX "ai_usage_logs_user_id_created_at_idx" ON "ai_usage_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_logs_search_run_id_idx" ON "ai_usage_logs"("search_run_id");

-- CreateIndex
CREATE INDEX "ai_usage_logs_created_at_status_idx" ON "ai_usage_logs"("created_at", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_tariffs_model_call_type_unit_effective_from_key" ON "ai_tariffs"("model", "call_type", "unit", "effective_from");

-- CreateIndex
CREATE INDEX "ai_budget_reservations_usage_log_id_idx" ON "ai_budget_reservations"("usage_log_id");

-- CreateIndex
CREATE INDEX "ai_budget_reservations_status_created_at_idx" ON "ai_budget_reservations"("status", "created_at");

-- CreateIndex
CREATE INDEX "calendar_events_owner_user_id_start_at_idx" ON "calendar_events"("owner_user_id", "start_at");

-- CreateIndex
CREATE INDEX "calendar_events_start_at_idx" ON "calendar_events"("start_at");

-- CreateIndex
CREATE INDEX "calendar_events_client_id_idx" ON "calendar_events"("client_id");

-- CreateIndex
CREATE INDEX "calendar_events_need_id_idx" ON "calendar_events"("need_id");

-- CreateIndex
CREATE INDEX "calendar_events_property_id_idx" ON "calendar_events"("property_id");

-- CreateIndex
CREATE INDEX "calendar_events_deal_id_idx" ON "calendar_events"("deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedup_key_key" ON "notifications"("dedup_key");

-- CreateIndex
CREATE INDEX "notifications_recipient_user_id_state_trigger_at_idx" ON "notifications"("recipient_user_id", "state", "trigger_at");

-- CreateIndex
CREATE INDEX "notifications_state_trigger_at_idx" ON "notifications"("state", "trigger_at");

-- CreateIndex
CREATE INDEX "notifications_source_type_source_id_idx" ON "notifications"("source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_key" ON "notification_preferences"("user_id");

-- CreateIndex
CREATE INDEX "deal_checklist_items_responsible_user_id_idx" ON "deal_checklist_items"("responsible_user_id");

-- CreateIndex
CREATE INDEX "deal_checklist_items_document_id_idx" ON "deal_checklist_items"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "deal_checklist_items_deal_id_code_key" ON "deal_checklist_items"("deal_id", "code");

-- CreateIndex
CREATE INDEX "legal_entities_logo_document_id_idx" ON "legal_entities"("logo_document_id");

-- AddForeignKey
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_logo_document_id_fkey" FOREIGN KEY ("logo_document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_listings" ADD CONSTRAINT "external_listings_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_listing_snapshots" ADD CONSTRAINT "external_listing_snapshots_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "external_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_listing_snapshots" ADD CONSTRAINT "external_listing_snapshots_search_run_id_fkey" FOREIGN KEY ("search_run_id") REFERENCES "search_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_listing_verifications" ADD CONSTRAINT "external_listing_verifications_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "external_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_listing_verifications" ADD CONSTRAINT "external_listing_verifications_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_bookmarks" ADD CONSTRAINT "search_bookmarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_bookmarks" ADD CONSTRAINT "search_bookmarks_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "external_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_selections" ADD CONSTRAINT "search_selections_need_id_fkey" FOREIGN KEY ("need_id") REFERENCES "client_needs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_selections" ADD CONSTRAINT "search_selections_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "external_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_selections" ADD CONSTRAINT "search_selections_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_selections" ADD CONSTRAINT "search_selections_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_selections" ADD CONSTRAINT "search_selections_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "need_property_matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_need_id_fkey" FOREIGN KEY ("need_id") REFERENCES "client_needs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_last_successful_run_id_fkey" FOREIGN KEY ("last_successful_run_id") REFERENCES "search_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_runs" ADD CONSTRAINT "search_runs_saved_search_id_fkey" FOREIGN KEY ("saved_search_id") REFERENCES "saved_searches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_runs" ADD CONSTRAINT "search_runs_need_id_fkey" FOREIGN KEY ("need_id") REFERENCES "client_needs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_runs" ADD CONSTRAINT "search_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_run_sources" ADD CONSTRAINT "search_run_sources_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "search_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_run_results" ADD CONSTRAINT "search_run_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "search_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_run_results" ADD CONSTRAINT "search_run_results_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "external_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_search_run_id_fkey" FOREIGN KEY ("search_run_id") REFERENCES "search_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_budget_reservations" ADD CONSTRAINT "ai_budget_reservations_usage_log_id_fkey" FOREIGN KEY ("usage_log_id") REFERENCES "ai_usage_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_need_id_fkey" FOREIGN KEY ("need_id") REFERENCES "client_needs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_checklist_items" ADD CONSTRAINT "deal_checklist_items_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_checklist_items" ADD CONSTRAINT "deal_checklist_items_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_checklist_items" ADD CONSTRAINT "deal_checklist_items_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "external_listings" ADD CONSTRAINT "external_listings_source_check" CHECK ("source" IN ('cian', 'mirkvartir', 'onrealt', 'domclick', 'yandex', 'youla', 'avito', 'web_search', 'manual'));
ALTER TABLE "external_listings" ADD CONSTRAINT "external_listings_source_method_check" CHECK ("source_method" IN ('scraper', 'web_search', 'manual'));
ALTER TABLE "external_listings" ADD CONSTRAINT "external_listings_operation_check" CHECK ("operation" IN ('sale', 'rent'));
ALTER TABLE "external_listings" ADD CONSTRAINT "external_listings_price_unit_check" CHECK ("price_unit" IN ('total', 'per_month', 'per_m2', 'per_m2_month', 'per_year', 'per_m2_year'));
ALTER TABLE "external_listing_verifications" ADD CONSTRAINT "external_listing_verifications_availability_check" CHECK ("availability" IN ('available', 'reserved', 'withdrawn', 'unknown'));
ALTER TABLE "search_bookmarks" ADD CONSTRAINT "search_bookmarks_status_check" CHECK ("status" IN ('study', 'clarify', 'exclude'));
ALTER TABLE "search_selections" ADD CONSTRAINT "search_selections_review_status_check" CHECK ("review_status" IN ('candidate', 'shortlisted', 'rejected', 'proposed'));
ALTER TABLE "search_runs" ADD CONSTRAINT "search_runs_status_check" CHECK ("status" IN ('pending', 'running', 'success', 'partial', 'error', 'cancelled'));
ALTER TABLE "search_run_sources" ADD CONSTRAINT "search_run_sources_source_check" CHECK ("source" IN ('cian', 'mirkvartir', 'onrealt', 'domclick', 'yandex', 'youla', 'avito', 'web_search', 'manual'));
ALTER TABLE "search_run_sources" ADD CONSTRAINT "search_run_sources_status_check" CHECK ("status" IN ('success', 'partial', 'blocked', 'timeout', 'unsupported_filter', 'error', 'disabled'));
ALTER TABLE "search_run_results" ADD CONSTRAINT "search_run_results_verdict_check" CHECK ("verdict" IN ('confirmed', 'needs_review', 'rejected'));
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_call_type_check" CHECK ("call_type" IN ('parse', 'description', 'web_search'));
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_status_check" CHECK ("status" IN ('pending', 'running', 'success', 'error', 'cancelled'));
ALTER TABLE "ai_tariffs" ADD CONSTRAINT "ai_tariffs_call_type_check" CHECK ("call_type" IN ('parse', 'description', 'web_search'));
ALTER TABLE "ai_tariffs" ADD CONSTRAINT "ai_tariffs_unit_check" CHECK ("unit" IN ('input_token', 'output_token', 'input_million_tokens', 'output_million_tokens', 'web_search_call'));
ALTER TABLE "ai_budget_reservations" ADD CONSTRAINT "ai_budget_reservations_status_check" CHECK ("status" IN ('reserved', 'settled', 'released'));
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_search_context_size_check" CHECK ("search_context_size" IN ('low', 'medium', 'high'));
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_visibility_check" CHECK ("visibility" IN ('public', 'private'));
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_state_check" CHECK ("state" IN ('pending', 'delivered', 'read', 'dismissed'));
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK ("kind" IN ('task', 'assignment', 'showing', 'agreement', 'pause_return', 'annual_contact', 'postdeal', 'calendar_event'));
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_source_type_check" CHECK ("source_type" IN ('task', 'showing', 'agreement', 'calendar_event'));
ALTER TABLE "document_properties" ADD CONSTRAINT "document_properties_kind_check" CHECK ("kind" IN ('photo', 'document'));
ALTER TABLE "deal_checklist_items" ADD CONSTRAINT "deal_checklist_items_status_check" CHECK ("status" IN ('none', 'review', 'verified', 'not_required'));
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_task_type_check";
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_task_type_check" CHECK ("task_type" IN ('pause_return', 'call_or_contact', 'showing_or_meeting', 'commercial_offer', 'document', 'advertising_check', 'contract_check', 'postdeal', 'other'));

-- Missing listing identifiers cannot establish identity: those rows need manual review.
CREATE UNIQUE INDEX external_listings_source_identity_key ON external_listings
  (source, source_listing_id, source_unit_id) NULLS NOT DISTINCT
  WHERE source_listing_id IS NOT NULL;
CREATE UNIQUE INDEX ai_settings_singleton_key ON ai_settings ((true));
CREATE UNIQUE INDEX document_properties_active_cover_key ON document_properties (property_id)
  WHERE is_cover AND kind = 'photo' AND archived_at IS NULL;

ALTER TABLE external_listings ADD CONSTRAINT external_listings_values_check CHECK (
  (price_rub IS NULL OR price_rub >= 0) AND (last_price IS NULL OR last_price >= 0)
  AND (area_m2 IS NULL OR area_m2 > 0) AND last_seen_at >= first_seen_at
  AND jsonb_typeof(images) = 'array'
  AND (NOT owner_confirmed OR (owner_confirmed_at IS NOT NULL
    AND nullif(btrim(owner_confirmation_method), '') IS NOT NULL
    AND nullif(btrim(owner_confirmation_source), '') IS NOT NULL)));
ALTER TABLE external_listing_snapshots ADD CONSTRAINT external_listing_snapshots_values_check
  CHECK ((price_rub IS NULL OR price_rub >= 0) AND jsonb_typeof(normalized) = 'object');
ALTER TABLE search_run_sources ADD CONSTRAINT search_run_sources_counts_check
  CHECK (result_count >= 0 AND (duration_ms IS NULL OR duration_ms >= 0));
ALTER TABLE search_runs ADD CONSTRAINT search_runs_dates_check CHECK (finished_at IS NULL OR finished_at >= started_at);
ALTER TABLE search_run_results ADD CONSTRAINT search_run_results_criteria_check CHECK (jsonb_typeof(criteria) = 'array');
ALTER TABLE ai_settings ADD CONSTRAINT ai_settings_limits_check CHECK (
  per_user_daily_limit >= 0 AND per_job_limit >= 0 AND daily_limit >= 0 AND monthly_budget_rub >= 0);
ALTER TABLE ai_usage_logs ADD CONSTRAINT ai_usage_logs_counts_check CHECK (
  input_tokens >= 0 AND output_tokens >= 0 AND web_search_calls >= 0 AND estimated_cost_rub >= 0
  AND (actual_cost_rub IS NULL OR actual_cost_rub >= 0) AND (duration_ms IS NULL OR duration_ms >= 0));
ALTER TABLE ai_tariffs ADD CONSTRAINT ai_tariffs_price_check CHECK (price_rub >= 0);
ALTER TABLE ai_budget_reservations ADD CONSTRAINT ai_budget_reservations_amount_check CHECK (amount_rub >= 0);
ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_interval_check CHECK (end_at > start_at);
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_lead_check CHECK (lead_minutes >= 0);
ALTER TABLE document_properties ADD CONSTRAINT document_properties_cover_photo_check
  CHECK (NOT is_cover OR (kind = 'photo' AND archived_at IS NULL));

-- Gallery migration preserves every existing link and archived state, without choosing a cover arbitrarily.
UPDATE document_properties AS dp SET kind = 'photo', archived_at = d.archived_at
  FROM documents AS d WHERE dp.document_id = d.id AND d.document_type_code = 'photo';

-- Covers must reference active documents, including direct SQL writes.
-- Lock the document to serialize a concurrent archive against cover assignment.
CREATE FUNCTION enforce_active_property_cover() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document_archived_at timestamptz;
BEGIN
  IF NEW.is_cover THEN
    SELECT archived_at INTO document_archived_at FROM documents WHERE id = NEW.document_id FOR SHARE;
    IF document_archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'Archived document cannot be a property cover' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER document_properties_active_cover BEFORE INSERT OR UPDATE ON document_properties
  FOR EACH ROW EXECUTE FUNCTION enforce_active_property_cover();
CREATE FUNCTION clear_archived_document_cover() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.archived_at IS NOT NULL AND OLD.archived_at IS DISTINCT FROM NEW.archived_at THEN
    UPDATE document_properties SET is_cover = false WHERE document_id = NEW.id AND is_cover;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER documents_clear_archived_cover AFTER UPDATE OF archived_at ON documents
  FOR EACH ROW EXECUTE FUNCTION clear_archived_document_cover();
COMMIT;
