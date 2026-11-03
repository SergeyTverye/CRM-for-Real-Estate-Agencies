-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "login" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "role_code" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "password_changed_at" TIMESTAMPTZ(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "user_agent" TEXT,
    "ip_address" TEXT,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_contact_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "granted_by" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "comment" TEXT,

    CONSTRAINT "property_contact_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "display_name" TEXT NOT NULL,
    "client_kind" TEXT NOT NULL,
    "responsible_user_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "notes" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_contact_persons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "position" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "client_contact_persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "contact_type" TEXT NOT NULL,
    "raw_value" TEXT NOT NULL,
    "normalized_value" TEXT,
    "contact_person_id" UUID,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID,
    "client_need_id" UUID,
    "property_id" UUID,
    "advertisement_id" UUID,
    "responsible_user_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "channel_code" TEXT NOT NULL,
    "source_code" TEXT NOT NULL,
    "result_code" TEXT NOT NULL,
    "status_code" TEXT NOT NULL,
    "summary" TEXT,
    "raw_contact" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lead_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_needs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "responsible_user_id" UUID NOT NULL,
    "operation_type" TEXT NOT NULL,
    "property_type" TEXT NOT NULL,
    "property_subtype" TEXT,
    "financing_type" TEXT,
    "mortgage_status" TEXT,
    "budget_min" DECIMAL(16,2),
    "budget_max" DECIMAL(16,2),
    "district" TEXT,
    "location_text" TEXT,
    "area_min" DECIMAL(12,2),
    "area_max" DECIMAL(12,2),
    "commercial_purpose" TEXT,
    "floor_min" INTEGER,
    "floor_max" INTEGER,
    "rooms_min" INTEGER,
    "rooms_max" INTEGER,
    "land_area_min" DECIMAL(12,2),
    "land_area_max" DECIMAL(12,2),
    "building_area_min" DECIMAL(12,2),
    "building_area_max" DECIMAL(12,2),
    "power_requirement" DECIMAL(10,2),
    "parking_requirement" BOOLEAN,
    "tenant_requirement" BOOLEAN,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stop_reason_code" TEXT,
    "stop_comment" TEXT,
    "notes" TEXT,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "client_needs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "need_stage_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_need_id" UUID NOT NULL,
    "from_stage" TEXT,
    "to_stage" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT,
    "reason_code" TEXT,
    "comment" TEXT,
    "changed_by" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "need_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "client_need_id" UUID,
    "lead_request_id" UUID,
    "author_user_id" UUID NOT NULL,
    "communication_type" TEXT NOT NULL,
    "channel_code" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "result_code" TEXT,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "responsible_user_id" UUID,
    "property_type" TEXT NOT NULL,
    "property_subtype" TEXT,
    "operation_type" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_platform_code" TEXT,
    "source_url" TEXT,
    "address_text" TEXT NOT NULL,
    "district" TEXT,
    "area" DECIMAL(12,2),
    "floor" INTEGER,
    "floors_total" INTEGER,
    "rooms_count" INTEGER,
    "land_area" DECIMAL(12,2),
    "building_area" DECIMAL(12,2),
    "price" DECIMAL(16,2),
    "commercial_purpose" TEXT,
    "power_kw" DECIMAL(10,2),
    "parking_available" BOOLEAN,
    "has_tenant" BOOLEAN,
    "status" TEXT NOT NULL,
    "description" TEXT,
    "attributes_jsonb" JSONB,
    "archived_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_owners" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "owner_role" TEXT,
    "ownership_share" DECIMAL(7,4),
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "need_property_matches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_need_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "offered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_code" TEXT,
    "status" TEXT NOT NULL,
    "rejection_reason_code" TEXT,
    "comment" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "need_property_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "showings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_need_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "responsible_user_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL,
    "result_code" TEXT,
    "comment" TEXT,
    "participants_text" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "showings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advertisements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "responsible_user_id" UUID,
    "platform_code" TEXT NOT NULL,
    "url" TEXT,
    "ad_text" TEXT,
    "status" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "last_checked_at" TIMESTAMPTZ(3),
    "expires_at" DATE,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "advertisements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID,
    "property_id" UUID,
    "deal_id" UUID,
    "responsible_user_id" UUID NOT NULL,
    "legal_entity_id" UUID,
    "agreement_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "agreement_number" TEXT,
    "is_exclusive" BOOLEAN,
    "signed_at" DATE,
    "valid_from" DATE,
    "valid_until" DATE,
    "commission_type" TEXT,
    "commission_value" DECIMAL(16,2),
    "commission_notes" TEXT,
    "absence_reason_code" TEXT,
    "action_required" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "responsible_user_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "task_type" TEXT NOT NULL,
    "task_subtype_code" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "recurrence_kind" TEXT NOT NULL DEFAULT 'none',
    "recurrence_interval" INTEGER NOT NULL DEFAULT 1,
    "recurrence_until" DATE,
    "parent_task_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "result_comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_clients" (
    "task_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,

    CONSTRAINT "task_clients_pkey" PRIMARY KEY ("task_id","client_id")
);

-- CreateTable
CREATE TABLE "task_needs" (
    "task_id" UUID NOT NULL,
    "client_need_id" UUID NOT NULL,

    CONSTRAINT "task_needs_pkey" PRIMARY KEY ("task_id","client_need_id")
);

-- CreateTable
CREATE TABLE "task_properties" (
    "task_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,

    CONSTRAINT "task_properties_pkey" PRIMARY KEY ("task_id","property_id")
);

-- CreateTable
CREATE TABLE "task_showings" (
    "task_id" UUID NOT NULL,
    "showing_id" UUID NOT NULL,

    CONSTRAINT "task_showings_pkey" PRIMARY KEY ("task_id","showing_id")
);

-- CreateTable
CREATE TABLE "task_deals" (
    "task_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,

    CONSTRAINT "task_deals_pkey" PRIMARY KEY ("task_id","deal_id")
);

-- CreateTable
CREATE TABLE "task_advertisements" (
    "task_id" UUID NOT NULL,
    "advertisement_id" UUID NOT NULL,

    CONSTRAINT "task_advertisements_pkey" PRIMARY KEY ("task_id","advertisement_id")
);

-- CreateTable
CREATE TABLE "task_agreements" (
    "task_id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,

    CONSTRAINT "task_agreements_pkey" PRIMARY KEY ("task_id","agreement_id")
);

-- CreateTable
CREATE TABLE "task_commercial_offers" (
    "task_id" UUID NOT NULL,
    "commercial_offer_id" UUID NOT NULL,

    CONSTRAINT "task_commercial_offers_pkey" PRIMARY KEY ("task_id","commercial_offer_id")
);

-- CreateTable
CREATE TABLE "legal_entities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_type" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "legal_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "responsible_user_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "preliminary_agreement_at" TIMESTAMPTZ(3),
    "main_agreement_at" TIMESTAMPTZ(3),
    "registration_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "deal_price" DECIMAL(16,2),
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_parties" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deal_id" UUID NOT NULL,
    "client_id" UUID,
    "external_party_name" TEXT,
    "party_role" TEXT NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_commissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deal_id" UUID NOT NULL,
    "payer_party_id" UUID,
    "amount" DECIMAL(16,2) NOT NULL,
    "status" TEXT NOT NULL,
    "due_at" DATE,
    "received_at" TIMESTAMPTZ(3),
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deal_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_offers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_need_id" UUID NOT NULL,
    "responsible_user_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "legal_entity_id" UUID,
    "status" TEXT NOT NULL,
    "title" TEXT,
    "intro_text" TEXT,
    "notes" TEXT,
    "generation_source" TEXT NOT NULL DEFAULT 'manual',
    "prompt_template_version" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "expires_at" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "commercial_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_offer_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "commercial_offer_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "price_snapshot" DECIMAL(16,2),
    "address_snapshot" TEXT,
    "area_snapshot" DECIMAL(12,2),
    "terms_snapshot" TEXT,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commercial_offer_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "original_name" TEXT NOT NULL,
    "document_type_code" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" BIGINT NOT NULL,
    "storage_provider" TEXT NOT NULL DEFAULT 'local',
    "storage_key" TEXT NOT NULL,
    "checksum" TEXT,
    "uploaded_by" UUID NOT NULL,
    "legal_entity_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_clients" (
    "document_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,

    CONSTRAINT "document_clients_pkey" PRIMARY KEY ("document_id","client_id")
);

-- CreateTable
CREATE TABLE "document_needs" (
    "document_id" UUID NOT NULL,
    "client_need_id" UUID NOT NULL,

    CONSTRAINT "document_needs_pkey" PRIMARY KEY ("document_id","client_need_id")
);

-- CreateTable
CREATE TABLE "document_properties" (
    "document_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,

    CONSTRAINT "document_properties_pkey" PRIMARY KEY ("document_id","property_id")
);

-- CreateTable
CREATE TABLE "document_showings" (
    "document_id" UUID NOT NULL,
    "showing_id" UUID NOT NULL,

    CONSTRAINT "document_showings_pkey" PRIMARY KEY ("document_id","showing_id")
);

-- CreateTable
CREATE TABLE "document_deals" (
    "document_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,

    CONSTRAINT "document_deals_pkey" PRIMARY KEY ("document_id","deal_id")
);

-- CreateTable
CREATE TABLE "document_advertisements" (
    "document_id" UUID NOT NULL,
    "advertisement_id" UUID NOT NULL,

    CONSTRAINT "document_advertisements_pkey" PRIMARY KEY ("document_id","advertisement_id")
);

-- CreateTable
CREATE TABLE "document_agreements" (
    "document_id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,

    CONSTRAINT "document_agreements_pkey" PRIMARY KEY ("document_id","agreement_id")
);

-- CreateTable
CREATE TABLE "document_commercial_offers" (
    "document_id" UUID NOT NULL,
    "commercial_offer_id" UUID NOT NULL,

    CONSTRAINT "document_commercial_offers_pkey" PRIMARY KEY ("document_id","commercial_offer_id")
);

-- CreateTable
CREATE TABLE "historical_deal_archive" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_file" TEXT NOT NULL,
    "source_row_id" TEXT,
    "source_row_key" TEXT NOT NULL,
    "deal_date" DATE,
    "deal_date_text" TEXT,
    "participant_name" TEXT,
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "property_type" TEXT,
    "object_text" TEXT,
    "party_role" TEXT,
    "area" DECIMAL(12,2),
    "price" DECIMAL(16,2),
    "conditions" TEXT,
    "realtor_text" TEXT,
    "contract_ref" TEXT,
    "commission_amount" DECIMAL(16,2),
    "additional_info" TEXT,
    "client_id" UUID,
    "import_job_id" UUID,
    "imported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historical_deal_archive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_filename" TEXT NOT NULL,
    "source_sha256" TEXT NOT NULL,
    "source_format" TEXT NOT NULL,
    "profile_code" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_by" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "rows_read" INTEGER NOT NULL DEFAULT 0,
    "rows_imported" INTEGER NOT NULL DEFAULT 0,
    "rows_skipped" INTEGER NOT NULL DEFAULT 0,
    "rows_error" INTEGER NOT NULL DEFAULT 0,
    "probable_duplicates" INTEGER NOT NULL DEFAULT 0,
    "mapping_version" TEXT NOT NULL,
    "report_storage_key" TEXT,
    "source_storage_key" TEXT,
    "summary_jsonb" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_row_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "import_job_id" UUID NOT NULL,
    "sheet_name" TEXT,
    "source_section" TEXT,
    "source_row_number" INTEGER,
    "source_record_key" TEXT,
    "target_entity_type" TEXT,
    "target_entity_id" UUID,
    "validation_status" TEXT NOT NULL,
    "commit_result" TEXT,
    "error_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "warning_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_row_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "backup_id" TEXT NOT NULL,
    "deployment_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),
    "initiated_by_user_id" UUID,
    "trigger_type" TEXT NOT NULL,
    "local_status" TEXT NOT NULL,
    "database_dump_size" BIGINT,
    "files_archive_size" BIGINT,
    "manifest_sha256" TEXT,
    "app_version" TEXT,
    "schema_version" TEXT,
    "error_summary" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_remotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "remote_code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "provider_type" TEXT NOT NULL,
    "transport_type" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "config_ref" TEXT NOT NULL,
    "remote_prefix" TEXT,
    "retention_daily" INTEGER,
    "retention_weekly" INTEGER,
    "last_probe_at" TIMESTAMPTZ(3),
    "probe_status" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "backup_remotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_target_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "backup_run_id" UUID NOT NULL,
    "backup_remote_id" UUID NOT NULL,
    "upload_status" TEXT NOT NULL,
    "verify_status" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "verified_at" TIMESTAMPTZ(3),
    "bytes_uploaded" BIGINT,
    "remote_backup_ref" TEXT,
    "error_code" TEXT,
    "error_summary" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "backup_target_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "before_jsonb" JSONB,
    "after_jsonb" JSONB,
    "correlation_id" UUID,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_code" TEXT NOT NULL,
    "feature_code" TEXT NOT NULL,
    "model_code" TEXT,
    "requested_by_user_id" UUID NOT NULL,
    "target_entity_type" TEXT,
    "target_entity_id" UUID,
    "prompt_template_version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "input_units" BIGINT,
    "output_units" BIGINT,
    "estimated_cost" DECIMAL(16,4),
    "output_document_id" UUID,
    "error_code" TEXT,
    "error_summary" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dictionary_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dictionary_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_login_key" ON "users"("login");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_token_hash_key" ON "user_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_expires_at_idx" ON "user_sessions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "property_contact_grants_property_id_idx" ON "property_contact_grants"("property_id");

-- CreateIndex
CREATE INDEX "property_contact_grants_user_id_idx" ON "property_contact_grants"("user_id");

-- CreateIndex
CREATE INDEX "property_contact_grants_granted_by_idx" ON "property_contact_grants"("granted_by");

-- CreateIndex
CREATE INDEX "clients_responsible_user_id_idx" ON "clients"("responsible_user_id");

-- CreateIndex
CREATE INDEX "clients_created_by_idx" ON "clients"("created_by");

-- CreateIndex
CREATE INDEX "clients_status_idx" ON "clients"("status");

-- CreateIndex
CREATE INDEX "clients_display_name_idx" ON "clients"("display_name");

-- CreateIndex
CREATE INDEX "client_contact_persons_client_id_idx" ON "client_contact_persons"("client_id");

-- CreateIndex
CREATE INDEX "client_contacts_client_id_idx" ON "client_contacts"("client_id");

-- CreateIndex
CREATE INDEX "client_contacts_normalized_value_idx" ON "client_contacts"("normalized_value");

-- CreateIndex
CREATE INDEX "client_contacts_contact_person_id_idx" ON "client_contacts"("contact_person_id");

-- CreateIndex
CREATE INDEX "lead_requests_responsible_user_id_occurred_at_idx" ON "lead_requests"("responsible_user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "lead_requests_source_code_occurred_at_idx" ON "lead_requests"("source_code", "occurred_at");

-- CreateIndex
CREATE INDEX "lead_requests_status_code_idx" ON "lead_requests"("status_code");

-- CreateIndex
CREATE INDEX "lead_requests_client_id_idx" ON "lead_requests"("client_id");

-- CreateIndex
CREATE INDEX "lead_requests_client_need_id_idx" ON "lead_requests"("client_need_id");

-- CreateIndex
CREATE INDEX "lead_requests_property_id_idx" ON "lead_requests"("property_id");

-- CreateIndex
CREATE INDEX "lead_requests_advertisement_id_idx" ON "lead_requests"("advertisement_id");

-- CreateIndex
CREATE INDEX "lead_requests_created_by_idx" ON "lead_requests"("created_by");

-- CreateIndex
CREATE INDEX "client_needs_client_id_idx" ON "client_needs"("client_id");

-- CreateIndex
CREATE INDEX "client_needs_responsible_user_id_status_idx" ON "client_needs"("responsible_user_id", "status");

-- CreateIndex
CREATE INDEX "client_needs_created_by_idx" ON "client_needs"("created_by");

-- CreateIndex
CREATE INDEX "need_stage_history_client_need_id_occurred_at_idx" ON "need_stage_history"("client_need_id", "occurred_at");

-- CreateIndex
CREATE INDEX "need_stage_history_changed_by_idx" ON "need_stage_history"("changed_by");

-- CreateIndex
CREATE INDEX "communications_client_id_occurred_at_idx" ON "communications"("client_id", "occurred_at");

-- CreateIndex
CREATE INDEX "communications_client_need_id_idx" ON "communications"("client_need_id");

-- CreateIndex
CREATE INDEX "communications_lead_request_id_idx" ON "communications"("lead_request_id");

-- CreateIndex
CREATE INDEX "communications_author_user_id_idx" ON "communications"("author_user_id");

-- CreateIndex
CREATE INDEX "properties_status_district_property_type_operation_type_idx" ON "properties"("status", "district", "property_type", "operation_type");

-- CreateIndex
CREATE INDEX "properties_responsible_user_id_idx" ON "properties"("responsible_user_id");

-- CreateIndex
CREATE INDEX "properties_created_by_idx" ON "properties"("created_by");

-- CreateIndex
CREATE INDEX "properties_address_text_idx" ON "properties"("address_text");

-- CreateIndex
CREATE INDEX "property_owners_client_id_idx" ON "property_owners"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_owners_property_id_client_id_key" ON "property_owners"("property_id", "client_id");

-- CreateIndex
CREATE INDEX "need_property_matches_client_need_id_offered_at_idx" ON "need_property_matches"("client_need_id", "offered_at");

-- CreateIndex
CREATE INDEX "need_property_matches_property_id_idx" ON "need_property_matches"("property_id");

-- CreateIndex
CREATE INDEX "need_property_matches_created_by_idx" ON "need_property_matches"("created_by");

-- CreateIndex
CREATE INDEX "showings_client_need_id_idx" ON "showings"("client_need_id");

-- CreateIndex
CREATE INDEX "showings_property_id_idx" ON "showings"("property_id");

-- CreateIndex
CREATE INDEX "showings_responsible_user_id_scheduled_at_idx" ON "showings"("responsible_user_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "showings_created_by_idx" ON "showings"("created_by");

-- CreateIndex
CREATE INDEX "advertisements_status_expires_at_idx" ON "advertisements"("status", "expires_at");

-- CreateIndex
CREATE INDEX "advertisements_responsible_user_id_idx" ON "advertisements"("responsible_user_id");

-- CreateIndex
CREATE INDEX "advertisements_property_id_idx" ON "advertisements"("property_id");

-- CreateIndex
CREATE INDEX "agreements_client_id_idx" ON "agreements"("client_id");

-- CreateIndex
CREATE INDEX "agreements_property_id_idx" ON "agreements"("property_id");

-- CreateIndex
CREATE INDEX "agreements_deal_id_idx" ON "agreements"("deal_id");

-- CreateIndex
CREATE INDEX "agreements_responsible_user_id_idx" ON "agreements"("responsible_user_id");

-- CreateIndex
CREATE INDEX "agreements_legal_entity_id_idx" ON "agreements"("legal_entity_id");

-- CreateIndex
CREATE INDEX "agreements_status_valid_until_idx" ON "agreements"("status", "valid_until");

-- CreateIndex
CREATE INDEX "tasks_responsible_user_id_status_due_at_idx" ON "tasks"("responsible_user_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "tasks_created_by_idx" ON "tasks"("created_by");

-- CreateIndex
CREATE INDEX "tasks_parent_task_id_idx" ON "tasks"("parent_task_id");

-- CreateIndex
CREATE INDEX "tasks_status_due_at_idx" ON "tasks"("status", "due_at");

-- CreateIndex
CREATE INDEX "task_clients_client_id_idx" ON "task_clients"("client_id");

-- CreateIndex
CREATE INDEX "task_needs_client_need_id_idx" ON "task_needs"("client_need_id");

-- CreateIndex
CREATE INDEX "task_properties_property_id_idx" ON "task_properties"("property_id");

-- CreateIndex
CREATE INDEX "task_showings_showing_id_idx" ON "task_showings"("showing_id");

-- CreateIndex
CREATE INDEX "task_deals_deal_id_idx" ON "task_deals"("deal_id");

-- CreateIndex
CREATE INDEX "task_advertisements_advertisement_id_idx" ON "task_advertisements"("advertisement_id");

-- CreateIndex
CREATE INDEX "task_agreements_agreement_id_idx" ON "task_agreements"("agreement_id");

-- CreateIndex
CREATE INDEX "task_commercial_offers_commercial_offer_id_idx" ON "task_commercial_offers"("commercial_offer_id");

-- CreateIndex
CREATE INDEX "deals_property_id_idx" ON "deals"("property_id");

-- CreateIndex
CREATE INDEX "deals_responsible_user_id_status_idx" ON "deals"("responsible_user_id", "status");

-- CreateIndex
CREATE INDEX "deals_legal_entity_id_idx" ON "deals"("legal_entity_id");

-- CreateIndex
CREATE INDEX "deals_created_by_idx" ON "deals"("created_by");

-- CreateIndex
CREATE INDEX "deal_parties_deal_id_idx" ON "deal_parties"("deal_id");

-- CreateIndex
CREATE INDEX "deal_parties_client_id_idx" ON "deal_parties"("client_id");

-- CreateIndex
CREATE INDEX "deal_commissions_deal_id_idx" ON "deal_commissions"("deal_id");

-- CreateIndex
CREATE INDEX "deal_commissions_payer_party_id_idx" ON "deal_commissions"("payer_party_id");

-- CreateIndex
CREATE INDEX "commercial_offers_client_need_id_status_sent_at_idx" ON "commercial_offers"("client_need_id", "status", "sent_at");

-- CreateIndex
CREATE INDEX "commercial_offers_responsible_user_id_idx" ON "commercial_offers"("responsible_user_id");

-- CreateIndex
CREATE INDEX "commercial_offers_created_by_idx" ON "commercial_offers"("created_by");

-- CreateIndex
CREATE INDEX "commercial_offers_legal_entity_id_idx" ON "commercial_offers"("legal_entity_id");

-- CreateIndex
CREATE INDEX "commercial_offer_items_commercial_offer_id_position_idx" ON "commercial_offer_items"("commercial_offer_id", "position");

-- CreateIndex
CREATE INDEX "commercial_offer_items_property_id_idx" ON "commercial_offer_items"("property_id");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_offer_items_commercial_offer_id_property_id_key" ON "commercial_offer_items"("commercial_offer_id", "property_id");

-- CreateIndex
CREATE UNIQUE INDEX "documents_storage_key_key" ON "documents"("storage_key");

-- CreateIndex
CREATE INDEX "documents_uploaded_by_idx" ON "documents"("uploaded_by");

-- CreateIndex
CREATE INDEX "documents_legal_entity_id_idx" ON "documents"("legal_entity_id");

-- CreateIndex
CREATE INDEX "document_clients_client_id_idx" ON "document_clients"("client_id");

-- CreateIndex
CREATE INDEX "document_needs_client_need_id_idx" ON "document_needs"("client_need_id");

-- CreateIndex
CREATE INDEX "document_properties_property_id_idx" ON "document_properties"("property_id");

-- CreateIndex
CREATE INDEX "document_showings_showing_id_idx" ON "document_showings"("showing_id");

-- CreateIndex
CREATE INDEX "document_deals_deal_id_idx" ON "document_deals"("deal_id");

-- CreateIndex
CREATE INDEX "document_advertisements_advertisement_id_idx" ON "document_advertisements"("advertisement_id");

-- CreateIndex
CREATE INDEX "document_agreements_agreement_id_idx" ON "document_agreements"("agreement_id");

-- CreateIndex
CREATE INDEX "document_commercial_offers_commercial_offer_id_idx" ON "document_commercial_offers"("commercial_offer_id");

-- CreateIndex
CREATE UNIQUE INDEX "historical_deal_archive_source_row_key_key" ON "historical_deal_archive"("source_row_key");

-- CreateIndex
CREATE INDEX "historical_deal_archive_client_id_idx" ON "historical_deal_archive"("client_id");

-- CreateIndex
CREATE INDEX "historical_deal_archive_import_job_id_idx" ON "historical_deal_archive"("import_job_id");

-- CreateIndex
CREATE INDEX "historical_deal_archive_deal_date_idx" ON "historical_deal_archive"("deal_date");

-- CreateIndex
CREATE INDEX "import_jobs_started_by_idx" ON "import_jobs"("started_by");

-- CreateIndex
CREATE INDEX "import_jobs_source_sha256_idx" ON "import_jobs"("source_sha256");

-- CreateIndex
CREATE INDEX "import_row_results_import_job_id_validation_status_idx" ON "import_row_results"("import_job_id", "validation_status");

-- CreateIndex
CREATE INDEX "import_row_results_import_job_id_commit_result_idx" ON "import_row_results"("import_job_id", "commit_result");

-- CreateIndex
CREATE INDEX "import_row_results_source_record_key_idx" ON "import_row_results"("source_record_key");

-- CreateIndex
CREATE UNIQUE INDEX "backup_runs_backup_id_key" ON "backup_runs"("backup_id");

-- CreateIndex
CREATE INDEX "backup_runs_deployment_id_started_at_idx" ON "backup_runs"("deployment_id", "started_at");

-- CreateIndex
CREATE INDEX "backup_runs_initiated_by_user_id_idx" ON "backup_runs"("initiated_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "backup_remotes_remote_code_key" ON "backup_remotes"("remote_code");

-- CreateIndex
CREATE INDEX "backup_target_runs_backup_remote_id_verify_status_finished__idx" ON "backup_target_runs"("backup_remote_id", "verify_status", "finished_at");

-- CreateIndex
CREATE UNIQUE INDEX "backup_target_runs_backup_run_id_backup_remote_id_key" ON "backup_target_runs"("backup_run_id", "backup_remote_id");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_occurred_at_idx" ON "audit_log"("entity_type", "entity_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_idx" ON "audit_log"("actor_user_id");

-- CreateIndex
CREATE INDEX "audit_log_occurred_at_idx" ON "audit_log"("occurred_at");

-- CreateIndex
CREATE INDEX "ai_runs_requested_by_user_id_created_at_idx" ON "ai_runs"("requested_by_user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_runs_feature_code_status_created_at_idx" ON "ai_runs"("feature_code", "status", "created_at");

-- CreateIndex
CREATE INDEX "ai_runs_output_document_id_idx" ON "ai_runs"("output_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "dictionary_items_category_code_key" ON "dictionary_items"("category", "code");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_contact_grants" ADD CONSTRAINT "property_contact_grants_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_contact_grants" ADD CONSTRAINT "property_contact_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_contact_grants" ADD CONSTRAINT "property_contact_grants_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_contact_persons" ADD CONSTRAINT "client_contact_persons_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_contact_person_id_fkey" FOREIGN KEY ("contact_person_id") REFERENCES "client_contact_persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_requests" ADD CONSTRAINT "lead_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_requests" ADD CONSTRAINT "lead_requests_client_need_id_fkey" FOREIGN KEY ("client_need_id") REFERENCES "client_needs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_requests" ADD CONSTRAINT "lead_requests_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_requests" ADD CONSTRAINT "lead_requests_advertisement_id_fkey" FOREIGN KEY ("advertisement_id") REFERENCES "advertisements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_requests" ADD CONSTRAINT "lead_requests_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_requests" ADD CONSTRAINT "lead_requests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_needs" ADD CONSTRAINT "client_needs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_needs" ADD CONSTRAINT "client_needs_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_needs" ADD CONSTRAINT "client_needs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "need_stage_history" ADD CONSTRAINT "need_stage_history_client_need_id_fkey" FOREIGN KEY ("client_need_id") REFERENCES "client_needs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "need_stage_history" ADD CONSTRAINT "need_stage_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_client_need_id_fkey" FOREIGN KEY ("client_need_id") REFERENCES "client_needs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_lead_request_id_fkey" FOREIGN KEY ("lead_request_id") REFERENCES "lead_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_owners" ADD CONSTRAINT "property_owners_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_owners" ADD CONSTRAINT "property_owners_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "need_property_matches" ADD CONSTRAINT "need_property_matches_client_need_id_fkey" FOREIGN KEY ("client_need_id") REFERENCES "client_needs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "need_property_matches" ADD CONSTRAINT "need_property_matches_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "need_property_matches" ADD CONSTRAINT "need_property_matches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "showings" ADD CONSTRAINT "showings_client_need_id_fkey" FOREIGN KEY ("client_need_id") REFERENCES "client_needs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "showings" ADD CONSTRAINT "showings_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "showings" ADD CONSTRAINT "showings_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "showings" ADD CONSTRAINT "showings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advertisements" ADD CONSTRAINT "advertisements_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advertisements" ADD CONSTRAINT "advertisements_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_clients" ADD CONSTRAINT "task_clients_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_clients" ADD CONSTRAINT "task_clients_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_needs" ADD CONSTRAINT "task_needs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_needs" ADD CONSTRAINT "task_needs_client_need_id_fkey" FOREIGN KEY ("client_need_id") REFERENCES "client_needs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_properties" ADD CONSTRAINT "task_properties_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_properties" ADD CONSTRAINT "task_properties_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_showings" ADD CONSTRAINT "task_showings_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_showings" ADD CONSTRAINT "task_showings_showing_id_fkey" FOREIGN KEY ("showing_id") REFERENCES "showings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_deals" ADD CONSTRAINT "task_deals_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_deals" ADD CONSTRAINT "task_deals_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_advertisements" ADD CONSTRAINT "task_advertisements_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_advertisements" ADD CONSTRAINT "task_advertisements_advertisement_id_fkey" FOREIGN KEY ("advertisement_id") REFERENCES "advertisements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_agreements" ADD CONSTRAINT "task_agreements_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_agreements" ADD CONSTRAINT "task_agreements_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_commercial_offers" ADD CONSTRAINT "task_commercial_offers_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_commercial_offers" ADD CONSTRAINT "task_commercial_offers_commercial_offer_id_fkey" FOREIGN KEY ("commercial_offer_id") REFERENCES "commercial_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_parties" ADD CONSTRAINT "deal_parties_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_parties" ADD CONSTRAINT "deal_parties_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_commissions" ADD CONSTRAINT "deal_commissions_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_commissions" ADD CONSTRAINT "deal_commissions_payer_party_id_fkey" FOREIGN KEY ("payer_party_id") REFERENCES "deal_parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_offers" ADD CONSTRAINT "commercial_offers_client_need_id_fkey" FOREIGN KEY ("client_need_id") REFERENCES "client_needs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_offers" ADD CONSTRAINT "commercial_offers_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_offers" ADD CONSTRAINT "commercial_offers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_offers" ADD CONSTRAINT "commercial_offers_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_offer_items" ADD CONSTRAINT "commercial_offer_items_commercial_offer_id_fkey" FOREIGN KEY ("commercial_offer_id") REFERENCES "commercial_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_offer_items" ADD CONSTRAINT "commercial_offer_items_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_clients" ADD CONSTRAINT "document_clients_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_clients" ADD CONSTRAINT "document_clients_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_needs" ADD CONSTRAINT "document_needs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_needs" ADD CONSTRAINT "document_needs_client_need_id_fkey" FOREIGN KEY ("client_need_id") REFERENCES "client_needs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_properties" ADD CONSTRAINT "document_properties_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_properties" ADD CONSTRAINT "document_properties_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_showings" ADD CONSTRAINT "document_showings_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_showings" ADD CONSTRAINT "document_showings_showing_id_fkey" FOREIGN KEY ("showing_id") REFERENCES "showings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_deals" ADD CONSTRAINT "document_deals_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_deals" ADD CONSTRAINT "document_deals_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_advertisements" ADD CONSTRAINT "document_advertisements_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_advertisements" ADD CONSTRAINT "document_advertisements_advertisement_id_fkey" FOREIGN KEY ("advertisement_id") REFERENCES "advertisements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_agreements" ADD CONSTRAINT "document_agreements_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_agreements" ADD CONSTRAINT "document_agreements_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_commercial_offers" ADD CONSTRAINT "document_commercial_offers_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_commercial_offers" ADD CONSTRAINT "document_commercial_offers_commercial_offer_id_fkey" FOREIGN KEY ("commercial_offer_id") REFERENCES "commercial_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_deal_archive" ADD CONSTRAINT "historical_deal_archive_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_deal_archive" ADD CONSTRAINT "historical_deal_archive_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "import_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_started_by_fkey" FOREIGN KEY ("started_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_row_results" ADD CONSTRAINT "import_row_results_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "import_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_initiated_by_user_id_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_target_runs" ADD CONSTRAINT "backup_target_runs_backup_run_id_fkey" FOREIGN KEY ("backup_run_id") REFERENCES "backup_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_target_runs" ADD CONSTRAINT "backup_target_runs_backup_remote_id_fkey" FOREIGN KEY ("backup_remote_id") REFERENCES "backup_remotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_output_document_id_fkey" FOREIGN KEY ("output_document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════
-- Ограничения, которые Prisma DSL не выражает (ТЗ 29.12, 29.13)
-- ═════════════════════════════════════════════════════════════════════

-- Системный codebook (ТЗ 19.6). Генерируется из src/shared/codebook.ts
ALTER TABLE "users" ADD CONSTRAINT "users_role_code_check" CHECK ("role_code" IN ('manager', 'realtor'));
ALTER TABLE "clients" ADD CONSTRAINT "clients_status_check" CHECK ("status" IN ('active', 'inactive', 'archived'));
ALTER TABLE "clients" ADD CONSTRAINT "clients_client_kind_check" CHECK ("client_kind" IN ('person', 'organization'));
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_contact_type_check" CHECK ("contact_type" IN ('phone', 'email', 'other'));
ALTER TABLE "client_needs" ADD CONSTRAINT "client_needs_status_check" CHECK ("status" IN ('active', 'paused', 'success', 'closed'));
ALTER TABLE "client_needs" ADD CONSTRAINT "client_needs_stage_check" CHECK ("stage" IN ('new', 'qualification', 'selection', 'showing', 'negotiation', 'preliminary_agreement', 'documents', 'deal', 'postdeal'));
ALTER TABLE "client_needs" ADD CONSTRAINT "client_needs_stop_reason_code_check" CHECK ("stop_reason_code" IS NULL OR "stop_reason_code" IN ('no_match', 'budget', 'no_contact', 'client_refused', 'chose_other', 'no_longer_relevant', 'duplicate_or_error', 'other'));
ALTER TABLE "client_needs" ADD CONSTRAINT "client_needs_financing_type_check" CHECK ("financing_type" IS NULL OR "financing_type" IN ('own_funds', 'mortgage', 'mixed', 'other', 'unknown'));
ALTER TABLE "client_needs" ADD CONSTRAINT "client_needs_mortgage_status_check" CHECK ("mortgage_status" IS NULL OR "mortgage_status" IN ('not_applicable', 'not_started', 'in_progress', 'approved', 'rejected', 'unknown'));
ALTER TABLE "need_stage_history" ADD CONSTRAINT "need_stage_history_to_stage_check" CHECK ("to_stage" IN ('new', 'qualification', 'selection', 'showing', 'negotiation', 'preliminary_agreement', 'documents', 'deal', 'postdeal'));
ALTER TABLE "need_stage_history" ADD CONSTRAINT "need_stage_history_from_stage_check" CHECK ("from_stage" IS NULL OR "from_stage" IN ('new', 'qualification', 'selection', 'showing', 'negotiation', 'preliminary_agreement', 'documents', 'deal', 'postdeal'));
ALTER TABLE "need_stage_history" ADD CONSTRAINT "need_stage_history_to_status_check" CHECK ("to_status" IS NULL OR "to_status" IN ('active', 'paused', 'success', 'closed'));
ALTER TABLE "need_stage_history" ADD CONSTRAINT "need_stage_history_from_status_check" CHECK ("from_status" IS NULL OR "from_status" IN ('active', 'paused', 'success', 'closed'));
ALTER TABLE "lead_requests" ADD CONSTRAINT "lead_requests_result_code_check" CHECK ("result_code" IN ('new_need', 'linked_existing_need', 'one_off_service', 'no_followup', 'invalid_or_spam'));
ALTER TABLE "lead_requests" ADD CONSTRAINT "lead_requests_status_code_check" CHECK ("status_code" IN ('open', 'processed', 'closed'));
ALTER TABLE "properties" ADD CONSTRAINT "properties_source_type_check" CHECK ("source_type" IN ('agency_listing', 'external_market'));
ALTER TABLE "properties" ADD CONSTRAINT "properties_status_check" CHECK ("status" IN ('draft', 'active', 'paused', 'closed', 'archived'));
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_status_check" CHECK ("status" IN ('draft', 'negotiating', 'signed', 'expired', 'terminated', 'declined', 'no_agreement', 'archived'));
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_agreement_type_check" CHECK ("agreement_type" IN ('information', 'exclusive', 'representation', 'lease_related', 'sale_related', 'other'));
ALTER TABLE "showings" ADD CONSTRAINT "showings_status_check" CHECK ("status" IN ('planned', 'completed', 'cancelled', 'no_show'));
ALTER TABLE "showings" ADD CONSTRAINT "showings_result_code_check" CHECK ("result_code" IS NULL OR "result_code" IN ('interested', 'thinking', 'rejected', 'negotiation', 'other'));
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_check" CHECK ("status" IN ('planned', 'in_progress', 'completed', 'cancelled'));
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_priority_check" CHECK ("priority" IN ('low', 'normal', 'high'));
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_task_type_check" CHECK ("task_type" IN ('call_or_contact', 'showing_or_meeting', 'commercial_offer', 'document', 'advertising_check', 'contract_check', 'postdeal', 'other'));
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence_kind_check" CHECK ("recurrence_kind" IN ('none', 'daily', 'weekly', 'monthly', 'yearly'));
ALTER TABLE "deals" ADD CONSTRAINT "deals_status_check" CHECK ("status" IN ('draft', 'preliminary_agreement', 'documents', 'registration', 'completed', 'cancelled'));
ALTER TABLE "deal_parties" ADD CONSTRAINT "deal_parties_party_role_check" CHECK ("party_role" IN ('buyer', 'seller', 'tenant', 'landlord', 'other'));
ALTER TABLE "deal_commissions" ADD CONSTRAINT "deal_commissions_status_check" CHECK ("status" IN ('planned', 'due', 'partially_received', 'received', 'waived', 'cancelled'));
ALTER TABLE "advertisements" ADD CONSTRAINT "advertisements_status_check" CHECK ("status" IN ('draft', 'active', 'paused', 'expired', 'removed'));
ALTER TABLE "commercial_offers" ADD CONSTRAINT "commercial_offers_status_check" CHECK ("status" IN ('draft', 'prepared', 'sent', 'accepted', 'rejected', 'expired', 'archived'));
ALTER TABLE "commercial_offers" ADD CONSTRAINT "commercial_offers_generation_source_check" CHECK ("generation_source" IN ('manual', 'template', 'ai_assisted'));
ALTER TABLE "need_property_matches" ADD CONSTRAINT "need_property_matches_status_check" CHECK ("status" IN ('proposed', 'interested', 'rejected', 'showing_planned', 'withdrawn'));
ALTER TABLE "communications" ADD CONSTRAINT "communications_communication_type_check" CHECK ("communication_type" IN ('call', 'message', 'email', 'meeting', 'other'));
ALTER TABLE "communications" ADD CONSTRAINT "communications_result_code_check" CHECK ("result_code" IS NULL OR "result_code" IN ('completed', 'no_answer', 'followup_required', 'client_refused', 'other'));
ALTER TABLE "documents" ADD CONSTRAINT "documents_document_type_code_check" CHECK ("document_type_code" IN ('agreement', 'title_document', 'commercial_offer', 'act', 'invoice', 'photo', 'other'));
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_entity_type_check" CHECK ("entity_type" IN ('IP', 'LLC'));
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_status_check" CHECK ("status" IN ('uploaded', 'parsing', 'dry_run_ready', 'dry_run_failed', 'committing', 'completed', 'completed_with_errors', 'failed', 'cancelled'));
ALTER TABLE "import_row_results" ADD CONSTRAINT "import_row_results_validation_status_check" CHECK ("validation_status" IN ('ready', 'warning', 'skipped_policy', 'invalid', 'unrecognized'));
ALTER TABLE "import_row_results" ADD CONSTRAINT "import_row_results_commit_result_check" CHECK ("commit_result" IS NULL OR "commit_result" IN ('imported', 'skipped', 'error'));
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_trigger_type_check" CHECK ("trigger_type" IN ('scheduled', 'manual', 'pre_update', 'pre_migration', 'shutdown'));
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_local_status_check" CHECK ("local_status" IN ('pending', 'running', 'success', 'failed'));
ALTER TABLE "backup_target_runs" ADD CONSTRAINT "backup_target_runs_upload_status_check" CHECK ("upload_status" IN ('pending', 'uploading', 'uploaded', 'failed', 'skipped'));
ALTER TABLE "backup_target_runs" ADD CONSTRAINT "backup_target_runs_verify_status_check" CHECK ("verify_status" IN ('not_verified', 'verifying', 'verified', 'failed'));
ALTER TABLE "backup_remotes" ADD CONSTRAINT "backup_remotes_provider_type_check" CHECK ("provider_type" IN ('yandex_s3', 'mailru_webdav', 'sberdisk_compat', 'filesystem', 'other'));
ALTER TABLE "backup_remotes" ADD CONSTRAINT "backup_remotes_transport_type_check" CHECK ("transport_type" IN ('s3', 'webdav', 'filesystem', 'other'));

-- Пользователи: login хранится нормализованным (lowercase), уникальность по нему.
ALTER TABLE "users" ADD CONSTRAINT "users_login_normalized_check" CHECK ("login" = lower("login") AND length("login") > 0);

-- Контакты клиента: уникальность нормализованного значения внутри карточки.
CREATE UNIQUE INDEX "client_contacts_client_type_normalized_key"
  ON "client_contacts" ("client_id", "contact_type", "normalized_value")
  WHERE "normalized_value" IS NOT NULL;

-- Активный grant на контакты собственника — один на пару объект/риелтор.
CREATE UNIQUE INDEX "property_contact_grants_active_key"
  ON "property_contact_grants" ("property_id", "user_id")
  WHERE "revoked_at" IS NULL;

-- ClientNeed: однотабличная часть инвариантов (межтабличная — в application transaction).
ALTER TABLE "client_needs" ADD CONSTRAINT "client_needs_closed_requires_reason_check"
  CHECK ("status" <> 'closed' OR ("stop_reason_code" IS NOT NULL AND "closed_at" IS NOT NULL));
ALTER TABLE "client_needs" ADD CONSTRAINT "client_needs_other_reason_comment_check"
  CHECK ("stop_reason_code" IS DISTINCT FROM 'other' OR ("stop_comment" IS NOT NULL AND length(btrim("stop_comment")) > 0));
ALTER TABLE "client_needs" ADD CONSTRAINT "client_needs_budget_range_check"
  CHECK ("budget_min" IS NULL OR "budget_max" IS NULL OR "budget_min" <= "budget_max");
ALTER TABLE "client_needs" ADD CONSTRAINT "client_needs_area_range_check"
  CHECK ("area_min" IS NULL OR "area_max" IS NULL OR "area_min" <= "area_max");

-- Задачи: подвид обязателен для постсделочных задач; корректная повторяемость.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_postdeal_subtype_check"
  CHECK (("task_type" <> 'postdeal') OR ("task_subtype_code" IN ('tax_declaration', 'rent_indexation', 'invoice', 'acceptance_act', 'premises_return', 'followup', 'other')));
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence_interval_check" CHECK ("recurrence_interval" >= 1);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_at_check"
  CHECK ("status" <> 'completed' OR "completed_at" IS NOT NULL);

-- Договор связан хотя бы с клиентом, объектом или сделкой; подписанный — с датой подписания.
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_link_required_check"
  CHECK ("client_id" IS NOT NULL OR "property_id" IS NOT NULL OR "deal_id" IS NOT NULL);
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_signed_date_check"
  CHECK ("status" <> 'signed' OR "signed_at" IS NOT NULL);

-- Участник сделки — карточка клиента либо внешний участник без фиктивной карточки.
ALTER TABLE "deal_parties" ADD CONSTRAINT "deal_parties_party_check"
  CHECK ("client_id" IS NOT NULL OR ("external_party_name" IS NOT NULL AND length(btrim("external_party_name")) > 0));

-- Деньги и размеры.
ALTER TABLE "deal_commissions" ADD CONSTRAINT "deal_commissions_amount_check" CHECK ("amount" >= 0);
ALTER TABLE "deals" ADD CONSTRAINT "deals_price_check" CHECK ("deal_price" IS NULL OR "deal_price" >= 0);
ALTER TABLE "properties" ADD CONSTRAINT "properties_price_check" CHECK ("price" IS NULL OR "price" >= 0);
ALTER TABLE "property_owners" ADD CONSTRAINT "property_owners_share_check"
  CHECK ("ownership_share" IS NULL OR ("ownership_share" > 0 AND "ownership_share" <= 1));
ALTER TABLE "documents" ADD CONSTRAINT "documents_file_size_check" CHECK ("file_size" >= 0);
ALTER TABLE "commercial_offer_items" ADD CONSTRAINT "commercial_offer_items_position_check" CHECK ("position" >= 1);
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_counters_check"
  CHECK ("rows_read" >= 0 AND "rows_imported" >= 0 AND "rows_skipped" >= 0 AND "rows_error" >= 0 AND "probable_duplicates" >= 0);

-- Поиск без учёта регистра по имени клиента и адресу объекта.
CREATE INDEX "clients_display_name_lower_idx" ON "clients" (lower("display_name"));
CREATE INDEX "properties_address_lower_idx" ON "properties" (lower("address_text"));
CREATE INDEX "tasks_title_lower_idx" ON "tasks" (lower("title"));
