BEGIN;
-- AlterTable
ALTER TABLE "lead_requests" ADD COLUMN     "call_at" TIMESTAMPTZ(3),
ADD COLUMN     "external_listing_id" UUID,
ADD COLUMN     "outcome_code" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "bulk_batch_id" UUID,
ADD COLUMN     "recurrence_rule" TEXT,
ADD COLUMN     "reminder_offsets" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "template_version_id" UUID,
ADD COLUMN     "values_snapshot" JSONB;

-- AlterTable
ALTER TABLE "external_listings" ADD COLUMN     "date_precision" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN     "date_source" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN     "fetched_at" TIMESTAMPTZ(3),
ADD COLUMN     "last_checked_at" TIMESTAMPTZ(3),
ADD COLUMN     "price_per_m2_rub" DECIMAL(16,2),
ADD COLUMN     "price_per_m2_unit" TEXT,
ADD COLUMN     "published_at" TIMESTAMPTZ(3),
ADD COLUMN     "purpose_evidence" JSONB,
ADD COLUMN     "source_category_raw" TEXT,
ADD COLUMN     "source_updated_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "external_listing_snapshots" ADD COLUMN     "area_m2" DECIMAL(12,2),
ADD COLUMN     "date_precision" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN     "date_source" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN     "first_seen_at" TIMESTAMPTZ(3),
ADD COLUMN     "last_checked_at" TIMESTAMPTZ(3),
ADD COLUMN     "last_seen_at" TIMESTAMPTZ(3),
ADD COLUMN     "price_per_m2_rub" DECIMAL(16,2),
ADD COLUMN     "price_per_m2_unit" TEXT,
ADD COLUMN     "published_at" TIMESTAMPTZ(3),
ADD COLUMN     "purpose_evidence" JSONB,
ADD COLUMN     "source_category_raw" TEXT,
ADD COLUMN     "source_updated_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "search_runs" ADD COLUMN     "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cancelled_at" TIMESTAMPTZ(3),
ADD COLUMN     "deadline_at" TIMESTAMPTZ(3),
ADD COLUMN     "depth_params" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "heartbeat_at" TIMESTAMPTZ(3),
ADD COLUMN     "idempotency_key" TEXT,
ADD COLUMN     "incomplete_reason" TEXT,
ADD COLUMN     "locked_by" TEXT,
ADD COLUMN     "progress" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "sort_params" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "search_run_sources" ADD COLUMN     "accepted_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "depth_reached" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "needs_user_action" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "received_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "requested_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "retry_after_at" TIMESTAMPTZ(3),
ADD COLUMN     "status_reason_ru" TEXT;

-- CreateTable
CREATE TABLE "interactive_browser_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "search_run_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "start_url_host" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "close_reason" TEXT,

    CONSTRAINT "interactive_browser_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_duplicate_groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" TEXT NOT NULL DEFAULT 'probable',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "listing_duplicate_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_duplicate_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "group_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "released_at" TIMESTAMPTZ(3),

    CONSTRAINT "listing_duplicate_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_duplicate_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "group_id" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "decided_by" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,

    CONSTRAINT "listing_duplicate_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_checklist_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "responsible_user_id" UUID,
    "due_at" TIMESTAMPTZ(3),
    "required" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'open',
    "result" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "completed_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "task_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planner_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "soon_threshold_hours" INTEGER NOT NULL DEFAULT 24,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "planner_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_task_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "idempotency_key" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "count" INTEGER NOT NULL,
    "template" JSONB NOT NULL,

    CONSTRAINT "bulk_task_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_collections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "property_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_collection_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "collection_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "external_listing_id" UUID,
    "property_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'in_collection',
    "comment" TEXT,
    "exclusion_reason" TEXT,
    "added_by" UUID NOT NULL,
    "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "property_collection_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_collection_needs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "collection_id" UUID NOT NULL,
    "need_id" UUID NOT NULL,
    "linked_by" UUID NOT NULL,
    "linked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_collection_needs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "allowed_sources" TEXT[],
    "current_version_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_template_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "template_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "manifest_yaml" TEXT NOT NULL,
    "storage_key" TEXT,
    "markdown_body" TEXT,
    "checksum" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "compatibility_note" TEXT,

    CONSTRAINT "document_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_chat_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "context_type" TEXT NOT NULL DEFAULT 'none',
    "context_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "ai_chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_chat_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tool_name" TEXT,
    "tool_args" JSONB,
    "tool_result_summary" TEXT,
    "ai_usage_log_id" UUID,
    "pending_action_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_pending_actions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "action_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),

    CONSTRAINT "ai_pending_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_analysis_caches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cache_key" TEXT NOT NULL,
    "listing_id" UUID NOT NULL,
    "result" JSONB NOT NULL,
    "ai_usage_log_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_analysis_caches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_exports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "format" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "columns" TEXT[],
    "row_count" INTEGER NOT NULL,
    "document_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "interactive_browser_sessions_search_run_id_source_idx" ON "interactive_browser_sessions"("search_run_id", "source");

-- CreateIndex
CREATE INDEX "interactive_browser_sessions_owner_user_id_status_expires_a_idx" ON "interactive_browser_sessions"("owner_user_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "interactive_browser_sessions_status_expires_at_idx" ON "interactive_browser_sessions"("status", "expires_at");

-- CreateIndex
CREATE INDEX "listing_duplicate_groups_status_created_at_idx" ON "listing_duplicate_groups"("status", "created_at");

-- CreateIndex
CREATE INDEX "listing_duplicate_members_listing_id_idx" ON "listing_duplicate_members"("listing_id");

-- CreateIndex
CREATE UNIQUE INDEX "listing_duplicate_members_group_id_listing_id_key" ON "listing_duplicate_members"("group_id", "listing_id");

-- CreateIndex
CREATE INDEX "listing_duplicate_decisions_group_id_decided_at_idx" ON "listing_duplicate_decisions"("group_id", "decided_at");

-- CreateIndex
CREATE INDEX "listing_duplicate_decisions_decided_by_idx" ON "listing_duplicate_decisions"("decided_by");

-- CreateIndex
CREATE INDEX "task_checklist_items_task_id_sort_order_idx" ON "task_checklist_items"("task_id", "sort_order");

-- CreateIndex
CREATE INDEX "task_checklist_items_responsible_user_id_status_due_at_idx" ON "task_checklist_items"("responsible_user_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "task_checklist_items_completed_by_idx" ON "task_checklist_items"("completed_by");

-- CreateIndex
CREATE INDEX "planner_settings_updated_by_idx" ON "planner_settings"("updated_by");

-- CreateIndex
CREATE UNIQUE INDEX "bulk_task_batches_idempotency_key_key" ON "bulk_task_batches"("idempotency_key");

-- CreateIndex
CREATE INDEX "bulk_task_batches_created_by_created_at_idx" ON "bulk_task_batches"("created_by", "created_at");

-- CreateIndex
CREATE INDEX "property_collections_owner_user_id_archived_at_updated_at_idx" ON "property_collections"("owner_user_id", "archived_at", "updated_at");

-- CreateIndex
CREATE INDEX "property_collections_visibility_archived_at_idx" ON "property_collections"("visibility", "archived_at");

-- CreateIndex
CREATE INDEX "property_collection_items_collection_id_sort_order_idx" ON "property_collection_items"("collection_id", "sort_order");

-- CreateIndex
CREATE INDEX "property_collection_items_external_listing_id_idx" ON "property_collection_items"("external_listing_id");

-- CreateIndex
CREATE INDEX "property_collection_items_property_id_idx" ON "property_collection_items"("property_id");

-- CreateIndex
CREATE INDEX "property_collection_items_added_by_idx" ON "property_collection_items"("added_by");

-- CreateIndex
CREATE UNIQUE INDEX "property_collection_items_collection_id_external_listing_id_key" ON "property_collection_items"("collection_id", "external_listing_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_collection_items_collection_id_property_id_key" ON "property_collection_items"("collection_id", "property_id");

-- CreateIndex
CREATE INDEX "property_collection_needs_need_id_linked_at_idx" ON "property_collection_needs"("need_id", "linked_at");

-- CreateIndex
CREATE INDEX "property_collection_needs_linked_by_idx" ON "property_collection_needs"("linked_by");

-- CreateIndex
CREATE UNIQUE INDEX "property_collection_needs_collection_id_need_id_key" ON "property_collection_needs"("collection_id", "need_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_templates_code_key" ON "document_templates"("code");

-- CreateIndex
CREATE UNIQUE INDEX "document_templates_current_version_id_key" ON "document_templates"("current_version_id");

-- CreateIndex
CREATE INDEX "document_templates_status_name_idx" ON "document_templates"("status", "name");

-- CreateIndex
CREATE INDEX "document_template_versions_created_by_idx" ON "document_template_versions"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "document_template_versions_template_id_version_key" ON "document_template_versions"("template_id", "version");

-- CreateIndex
CREATE INDEX "ai_chat_sessions_owner_user_id_archived_at_updated_at_idx" ON "ai_chat_sessions"("owner_user_id", "archived_at", "updated_at");

-- CreateIndex
CREATE INDEX "ai_chat_sessions_context_type_context_id_idx" ON "ai_chat_sessions"("context_type", "context_id");

-- CreateIndex
CREATE INDEX "ai_chat_messages_session_id_created_at_id_idx" ON "ai_chat_messages"("session_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "ai_chat_messages_ai_usage_log_id_idx" ON "ai_chat_messages"("ai_usage_log_id");

-- CreateIndex
CREATE INDEX "ai_chat_messages_pending_action_id_idx" ON "ai_chat_messages"("pending_action_id");

-- CreateIndex
CREATE INDEX "ai_pending_actions_session_id_status_idx" ON "ai_pending_actions"("session_id", "status");

-- CreateIndex
CREATE INDEX "ai_pending_actions_decided_by_idx" ON "ai_pending_actions"("decided_by");

-- CreateIndex
CREATE INDEX "ai_pending_actions_status_expires_at_idx" ON "ai_pending_actions"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_analysis_caches_cache_key_key" ON "ai_analysis_caches"("cache_key");

-- CreateIndex
CREATE INDEX "ai_analysis_caches_listing_id_idx" ON "ai_analysis_caches"("listing_id");

-- CreateIndex
CREATE INDEX "ai_analysis_caches_ai_usage_log_id_idx" ON "ai_analysis_caches"("ai_usage_log_id");

-- CreateIndex
CREATE INDEX "search_exports_user_id_created_at_idx" ON "search_exports"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "search_exports_document_id_idx" ON "search_exports"("document_id");

-- CreateIndex
CREATE INDEX "lead_requests_external_listing_id_idx" ON "lead_requests"("external_listing_id");

-- CreateIndex
CREATE INDEX "lead_requests_call_at_responsible_user_id_idx" ON "lead_requests"("call_at", "responsible_user_id");

-- CreateIndex
CREATE INDEX "lead_requests_outcome_code_occurred_at_idx" ON "lead_requests"("outcome_code", "occurred_at");

-- CreateIndex
CREATE INDEX "tasks_bulk_batch_id_idx" ON "tasks"("bulk_batch_id");

-- CreateIndex
CREATE INDEX "documents_template_version_id_idx" ON "documents"("template_version_id");

-- CreateIndex
CREATE INDEX "external_listings_published_at_id_idx" ON "external_listings"("published_at", "id");

-- CreateIndex
CREATE INDEX "external_listings_source_updated_at_id_idx" ON "external_listings"("source_updated_at", "id");

-- CreateIndex
CREATE INDEX "external_listings_first_seen_at_id_idx" ON "external_listings"("first_seen_at", "id");

-- CreateIndex
CREATE INDEX "external_listings_price_rub_id_idx" ON "external_listings"("price_rub", "id");

-- CreateIndex
CREATE INDEX "external_listings_price_per_m2_unit_price_per_m2_rub_id_idx" ON "external_listings"("price_per_m2_unit", "price_per_m2_rub", "id");

-- CreateIndex
CREATE INDEX "external_listings_area_m2_id_idx" ON "external_listings"("area_m2", "id");

-- CreateIndex
CREATE INDEX "external_listings_last_checked_at_id_idx" ON "external_listings"("last_checked_at", "id");

-- CreateIndex
CREATE INDEX "external_listing_snapshots_published_at_id_idx" ON "external_listing_snapshots"("published_at", "id");

-- CreateIndex
CREATE INDEX "external_listing_snapshots_source_updated_at_id_idx" ON "external_listing_snapshots"("source_updated_at", "id");

-- CreateIndex
CREATE INDEX "external_listing_snapshots_first_seen_at_id_idx" ON "external_listing_snapshots"("first_seen_at", "id");

-- CreateIndex
CREATE INDEX "external_listing_snapshots_price_rub_id_idx" ON "external_listing_snapshots"("price_rub", "id");

-- CreateIndex
CREATE INDEX "external_listing_snapshots_price_per_m2_unit_price_per_m2_r_idx" ON "external_listing_snapshots"("price_per_m2_unit", "price_per_m2_rub", "id");

-- CreateIndex
CREATE INDEX "external_listing_snapshots_area_m2_id_idx" ON "external_listing_snapshots"("area_m2", "id");

-- CreateIndex
CREATE INDEX "external_listing_snapshots_last_checked_at_id_idx" ON "external_listing_snapshots"("last_checked_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "search_runs_idempotency_key_key" ON "search_runs"("idempotency_key");

-- CreateIndex
CREATE INDEX "search_runs_status_heartbeat_at_started_at_idx" ON "search_runs"("status", "heartbeat_at", "started_at");

-- CreateIndex
CREATE INDEX "search_runs_deadline_at_idx" ON "search_runs"("deadline_at");

-- CreateIndex
CREATE INDEX "search_run_sources_status_retry_after_at_idx" ON "search_run_sources"("status", "retry_after_at");

-- AddForeignKey
ALTER TABLE "lead_requests" ADD CONSTRAINT "lead_requests_external_listing_id_fkey" FOREIGN KEY ("external_listing_id") REFERENCES "external_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_bulk_batch_id_fkey" FOREIGN KEY ("bulk_batch_id") REFERENCES "bulk_task_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "document_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactive_browser_sessions" ADD CONSTRAINT "interactive_browser_sessions_search_run_id_fkey" FOREIGN KEY ("search_run_id") REFERENCES "search_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactive_browser_sessions" ADD CONSTRAINT "interactive_browser_sessions_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_duplicate_members" ADD CONSTRAINT "listing_duplicate_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "listing_duplicate_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_duplicate_members" ADD CONSTRAINT "listing_duplicate_members_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "external_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_duplicate_decisions" ADD CONSTRAINT "listing_duplicate_decisions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "listing_duplicate_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_duplicate_decisions" ADD CONSTRAINT "listing_duplicate_decisions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planner_settings" ADD CONSTRAINT "planner_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_task_batches" ADD CONSTRAINT "bulk_task_batches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_collections" ADD CONSTRAINT "property_collections_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_collection_items" ADD CONSTRAINT "property_collection_items_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "property_collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_collection_items" ADD CONSTRAINT "property_collection_items_external_listing_id_fkey" FOREIGN KEY ("external_listing_id") REFERENCES "external_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_collection_items" ADD CONSTRAINT "property_collection_items_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_collection_items" ADD CONSTRAINT "property_collection_items_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_collection_needs" ADD CONSTRAINT "property_collection_needs_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "property_collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_collection_needs" ADD CONSTRAINT "property_collection_needs_need_id_fkey" FOREIGN KEY ("need_id") REFERENCES "client_needs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_collection_needs" ADD CONSTRAINT "property_collection_needs_linked_by_fkey" FOREIGN KEY ("linked_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "document_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "document_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_chat_sessions" ADD CONSTRAINT "ai_chat_sessions_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_chat_messages" ADD CONSTRAINT "ai_chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_chat_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_chat_messages" ADD CONSTRAINT "ai_chat_messages_ai_usage_log_id_fkey" FOREIGN KEY ("ai_usage_log_id") REFERENCES "ai_usage_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_chat_messages" ADD CONSTRAINT "ai_chat_messages_pending_action_id_fkey" FOREIGN KEY ("pending_action_id") REFERENCES "ai_pending_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_pending_actions" ADD CONSTRAINT "ai_pending_actions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_chat_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_pending_actions" ADD CONSTRAINT "ai_pending_actions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analysis_caches" ADD CONSTRAINT "ai_analysis_caches_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "external_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analysis_caches" ADD CONSTRAINT "ai_analysis_caches_ai_usage_log_id_fkey" FOREIGN KEY ("ai_usage_log_id") REFERENCES "ai_usage_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_exports" ADD CONSTRAINT "search_exports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_exports" ADD CONSTRAINT "search_exports_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Stable system codes; legacy search codes remain accepted.
ALTER TABLE "external_listings" ADD CONSTRAINT "external_listings_date_source_check" CHECK ("date_source" IN ('site_published', 'site_updated', 'relative_label', 'first_seen', 'unknown'));
ALTER TABLE "external_listings" ADD CONSTRAINT "external_listings_date_precision_check" CHECK ("date_precision" IN ('exact', 'day', 'relative', 'unknown'));
ALTER TABLE "external_listings" ADD CONSTRAINT "external_listings_price_per_m2_unit_check" CHECK ("price_per_m2_unit" IS NULL OR "price_per_m2_unit" IN ('per_m2', 'per_m2_month', 'per_m2_year'));
ALTER TABLE "external_listing_snapshots" ADD CONSTRAINT "external_listing_snapshots_date_source_check" CHECK ("date_source" IN ('site_published', 'site_updated', 'relative_label', 'first_seen', 'unknown'));
ALTER TABLE "external_listing_snapshots" ADD CONSTRAINT "external_listing_snapshots_date_precision_check" CHECK ("date_precision" IN ('exact', 'day', 'relative', 'unknown'));
ALTER TABLE "external_listing_snapshots" ADD CONSTRAINT "external_listing_snapshots_price_per_m2_unit_check" CHECK ("price_per_m2_unit" IS NULL OR "price_per_m2_unit" IN ('per_m2', 'per_m2_month', 'per_m2_year'));
ALTER TABLE "interactive_browser_sessions" ADD CONSTRAINT "interactive_browser_sessions_source_check" CHECK ("source" IN ('cian', 'mirkvartir', 'onrealt', 'domclick', 'yandex', 'youla', 'avito', 'web_search', 'manual'));
ALTER TABLE "interactive_browser_sessions" ADD CONSTRAINT "interactive_browser_sessions_status_check" CHECK ("status" IN ('pending', 'active', 'completed', 'cancelled', 'expired', 'failed'));
ALTER TABLE "listing_duplicate_groups" ADD CONSTRAINT "listing_duplicate_groups_status_check" CHECK ("status" IN ('auto_exact', 'probable', 'confirmed', 'rejected', 'deferred'));
ALTER TABLE "listing_duplicate_decisions" ADD CONSTRAINT "listing_duplicate_decisions_decision_check" CHECK ("decision" IN ('confirm', 'different', 'defer', 'split'));
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_status_check" CHECK ("status" IN ('open', 'done', 'cancelled'));
ALTER TABLE "lead_requests" ADD CONSTRAINT "lead_requests_outcome_code_check" CHECK ("outcome_code" IS NULL OR "outcome_code" IN ('spam', 'wrong', 'one_time', 'prospective'));
ALTER TABLE "property_collections" ADD CONSTRAINT "property_collections_visibility_check" CHECK ("visibility" IN ('private', 'team'));
ALTER TABLE "property_collection_items" ADD CONSTRAINT "property_collection_items_status_check" CHECK ("status" IN ('in_collection', 'check', 'in_crm', 'proposed', 'excluded'));
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_format_check" CHECK ("format" IN ('markdown_docx', 'docx', 'xlsx', 'xlsx_registry'));
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_status_check" CHECK ("status" IN ('active', 'disabled', 'archived'));
ALTER TABLE "ai_chat_sessions" ADD CONSTRAINT "ai_chat_sessions_context_type_check" CHECK ("context_type" IN ('client', 'need', 'collection', 'none'));
ALTER TABLE "ai_chat_messages" ADD CONSTRAINT "ai_chat_messages_role_check" CHECK ("role" IN ('user', 'assistant', 'tool'));
ALTER TABLE "ai_pending_actions" ADD CONSTRAINT "ai_pending_actions_status_check" CHECK ("status" IN ('proposed', 'confirmed', 'rejected', 'expired'));
ALTER TABLE "search_exports" ADD CONSTRAINT "search_exports_format_check" CHECK ("format" IN ('xlsx', 'csv'));
ALTER TABLE "search_exports" ADD CONSTRAINT "search_exports_scope_check" CHECK ("scope" IN ('all_filtered', 'selected'));
ALTER TABLE "search_runs" DROP CONSTRAINT "search_runs_status_check";
ALTER TABLE "search_runs" ADD CONSTRAINT "search_runs_status_check" CHECK ("status" IN ('queued', 'needs_user_action', 'completed', 'failed', 'pending', 'running', 'success', 'partial', 'error', 'cancelled'));
ALTER TABLE "search_run_sources" DROP CONSTRAINT "search_run_sources_status_check";
ALTER TABLE "search_run_sources" ADD CONSTRAINT "search_run_sources_status_check" CHECK ("status" IN ('queued', 'running', 'needs_user_action', 'completed', 'failed', 'cancelled', 'success', 'partial', 'blocked', 'timeout', 'unsupported_filter', 'error', 'disabled'));
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_priority_check";
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_priority_check" CHECK ("priority" IN ('low', 'normal', 'high', 'critical'));
-- v3.1 invariants not expressible in Prisma DSL.
CREATE UNIQUE INDEX "planner_settings_singleton_key" ON "planner_settings" ((true));
ALTER TABLE "planner_settings" ADD CONSTRAINT "planner_settings_threshold_check" CHECK ("soon_threshold_hours" > 0 AND "soon_threshold_hours" <= 8760);
ALTER TABLE "bulk_task_batches" ADD CONSTRAINT "bulk_task_batches_count_check" CHECK ("count" > 0);
ALTER TABLE "search_run_sources" ADD CONSTRAINT "search_run_sources_v31_counts_check" CHECK ("requested_count" >= 0 AND "received_count" >= 0 AND "accepted_count" >= 0 AND "depth_reached" >= 0 AND ("duration_ms" IS NULL OR "duration_ms" >= 0));
ALTER TABLE "interactive_browser_sessions" ADD CONSTRAINT "interactive_browser_sessions_interval_check" CHECK ("expires_at" > "created_at");
ALTER TABLE "interactive_browser_sessions" ADD CONSTRAINT "interactive_browser_sessions_host_check" CHECK (length("start_url_host") BETWEEN 1 AND 253 AND "start_url_host" ~ '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$');
ALTER TABLE "property_collection_items" ADD CONSTRAINT "property_collection_items_target_xor_check" CHECK (("external_listing_id" IS NOT NULL) <> ("property_id" IS NOT NULL));
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_positive_check" CHECK ("version" > 0);
ALTER TABLE "ai_chat_sessions" ADD CONSTRAINT "ai_chat_sessions_context_check" CHECK (("context_type" = 'none' AND "context_id" IS NULL) OR ("context_type" <> 'none' AND "context_id" IS NOT NULL));
ALTER TABLE "ai_pending_actions" ADD CONSTRAINT "ai_pending_actions_decision_check" CHECK (("status" IN ('confirmed', 'rejected') AND "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL) OR "status" IN ('proposed', 'expired'));
ALTER TABLE "search_exports" ADD CONSTRAINT "search_exports_row_count_check" CHECK ("row_count" >= 0);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reminder_offsets_check" CHECK (0 <= ALL("reminder_offsets"));
ALTER TABLE "external_listings" ADD CONSTRAINT "external_listings_price_per_m2_check" CHECK (("price_per_m2_rub" IS NULL AND "price_per_m2_unit" IS NULL) OR ("price_per_m2_rub" IS NOT NULL AND "price_per_m2_rub" >= 0 AND "price_per_m2_unit" IS NOT NULL));
ALTER TABLE "external_listing_snapshots" ADD CONSTRAINT "external_listing_snapshots_price_per_m2_check" CHECK (("price_per_m2_rub" IS NULL AND "price_per_m2_unit" IS NULL) OR ("price_per_m2_rub" IS NOT NULL AND "price_per_m2_rub" >= 0 AND "price_per_m2_unit" IS NOT NULL));

-- released_at retains membership history while allowing regrouping. Rejected groups
-- release their memberships; concurrent membership writes serialize on the group.
CREATE UNIQUE INDEX "listing_duplicate_members_active_listing_key" ON "listing_duplicate_members" ("listing_id") WHERE "released_at" IS NULL;
CREATE FUNCTION "v31_duplicate_member_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE group_status text;
BEGIN
  SELECT status INTO group_status FROM listing_duplicate_groups WHERE id = NEW.group_id FOR UPDATE;
  IF group_status = 'rejected' AND NEW.released_at IS NULL THEN NEW.released_at := CURRENT_TIMESTAMP; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "v31_duplicate_member_guard" BEFORE INSERT OR UPDATE ON "listing_duplicate_members" FOR EACH ROW EXECUTE FUNCTION "v31_duplicate_member_guard"();
CREATE FUNCTION "v31_duplicate_group_release"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'rejected' THEN
    UPDATE listing_duplicate_members SET released_at = CURRENT_TIMESTAMP WHERE group_id = NEW.id AND released_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "v31_duplicate_group_release" AFTER UPDATE OF status ON "listing_duplicate_groups" FOR EACH ROW EXECUTE FUNCTION "v31_duplicate_group_release"();

-- A template may point only to its own version. A composite FK also protects
-- against changing template_id on an already referenced version.
CREATE UNIQUE INDEX "document_template_versions_id_template_key" ON "document_template_versions" ("id", "template_id");
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_current_version_owner_fkey" FOREIGN KEY ("current_version_id", "id") REFERENCES "document_template_versions" ("id", "template_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX "ai_pending_actions_id_session_key" ON "ai_pending_actions" ("id", "session_id");
ALTER TABLE "ai_chat_messages" ADD CONSTRAINT "ai_chat_messages_pending_action_session_fkey" FOREIGN KEY ("pending_action_id", "session_id") REFERENCES "ai_pending_actions" ("id", "session_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

COMMIT;
