-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "login" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "role_code" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "password_changed_at" DATETIME,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "users_role_code_check" CHECK ("role_code" IN ('manager', 'realtor')),
    CONSTRAINT "users_login_normalized_check" CHECK ("login" = lower("login") AND length("login") > 0)
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "last_seen_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "expires_at" DATETIME NOT NULL,
    "revoked_at" DATETIME,
    "user_agent" TEXT,
    "ip_address" TEXT,
    CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "property_contact_grants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "property_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "granted_by" TEXT NOT NULL,
    "granted_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "revoked_at" DATETIME,
    "comment" TEXT,
    CONSTRAINT "property_contact_grants_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "property_contact_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "property_contact_grants_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "display_name" TEXT NOT NULL,
    "client_kind" TEXT NOT NULL,
    "responsible_user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "notes" TEXT,
    "archived_at" DATETIME,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "clients_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "clients_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "clients_status_check" CHECK ("status" IN ('active', 'inactive', 'archived')),
    CONSTRAINT "clients_client_kind_check" CHECK ("client_kind" IN ('person', 'organization'))
);

-- CreateTable
CREATE TABLE "client_contact_persons" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "client_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "position" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "client_contact_persons_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "client_contacts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "client_id" TEXT NOT NULL,
    "contact_type" TEXT NOT NULL,
    "raw_value" TEXT NOT NULL,
    "normalized_value" TEXT,
    "contact_person_id" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "comment" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    CONSTRAINT "client_contacts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "client_contacts_contact_person_id_fkey" FOREIGN KEY ("contact_person_id") REFERENCES "client_contact_persons" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "client_contacts_contact_type_check" CHECK ("contact_type" IN ('phone', 'email', 'other'))
);

-- CreateTable
CREATE TABLE "lead_requests" (
    "call_at" DATETIME,
    "external_listing_id" TEXT,
    "outcome_code" TEXT,
    "id" TEXT NOT NULL PRIMARY KEY,
    "client_id" TEXT,
    "client_need_id" TEXT,
    "property_id" TEXT,
    "advertisement_id" TEXT,
    "responsible_user_id" TEXT NOT NULL,
    "occurred_at" DATETIME NOT NULL,
    "channel_code" TEXT NOT NULL,
    "source_code" TEXT NOT NULL,
    "result_code" TEXT NOT NULL,
    "status_code" TEXT NOT NULL,
    "summary" TEXT,
    "raw_contact" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "lead_requests_external_listing_id_fkey" FOREIGN KEY ("external_listing_id") REFERENCES "external_listings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "lead_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "lead_requests_client_need_id_fkey" FOREIGN KEY ("client_need_id") REFERENCES "client_needs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "lead_requests_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "lead_requests_advertisement_id_fkey" FOREIGN KEY ("advertisement_id") REFERENCES "advertisements" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "lead_requests_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "lead_requests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "lead_requests_result_code_check" CHECK ("result_code" IN ('new_need', 'linked_existing_need', 'one_off_service', 'no_followup', 'invalid_or_spam')),
    CONSTRAINT "lead_requests_status_code_check" CHECK ("status_code" IN ('open', 'processed', 'closed')),
    CONSTRAINT "lead_requests_outcome_code_check" CHECK ("outcome_code" IS NULL OR "outcome_code" IN ('spam', 'wrong', 'one_time', 'prospective'))
);

-- CreateTable
CREATE TABLE "client_needs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "client_id" TEXT NOT NULL,
    "responsible_user_id" TEXT NOT NULL,
    "operation_type" TEXT NOT NULL,
    "property_type" TEXT NOT NULL,
    "property_subtype" TEXT,
    "financing_type" TEXT,
    "mortgage_status" TEXT,
    "budget_min" BIGINT,
    "budget_max" BIGINT,
    "district" TEXT,
    "location_text" TEXT,
    "area_min" BIGINT,
    "area_max" BIGINT,
    "commercial_purpose" TEXT,
    "floor_min" INTEGER,
    "floor_max" INTEGER,
    "rooms_min" INTEGER,
    "rooms_max" INTEGER,
    "land_area_min" BIGINT,
    "land_area_max" BIGINT,
    "building_area_min" BIGINT,
    "building_area_max" BIGINT,
    "power_requirement" BIGINT,
    "parking_requirement" BOOLEAN,
    "tenant_requirement" BOOLEAN,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stop_reason_code" TEXT,
    "stop_comment" TEXT,
    "notes" TEXT,
    "opened_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "closed_at" DATETIME,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "client_needs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "client_needs_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "client_needs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "client_needs_status_check" CHECK ("status" IN ('active', 'paused', 'success', 'closed')),
    CONSTRAINT "client_needs_stage_check" CHECK ("stage" IN ('new', 'qualification', 'selection', 'showing', 'negotiation', 'preliminary_agreement', 'documents', 'deal', 'postdeal')),
    CONSTRAINT "client_needs_stop_reason_code_check" CHECK ("stop_reason_code" IS NULL OR "stop_reason_code" IN ('no_match', 'budget', 'no_contact', 'client_refused', 'chose_other', 'no_longer_relevant', 'duplicate_or_error', 'other')),
    CONSTRAINT "client_needs_financing_type_check" CHECK ("financing_type" IS NULL OR "financing_type" IN ('own_funds', 'mortgage', 'mixed', 'other', 'unknown')),
    CONSTRAINT "client_needs_mortgage_status_check" CHECK ("mortgage_status" IS NULL OR "mortgage_status" IN ('not_applicable', 'not_started', 'in_progress', 'approved', 'rejected', 'unknown')),
    CONSTRAINT "client_needs_closed_requires_reason_check" CHECK ("status" <> 'closed' OR ("stop_reason_code" IS NOT NULL AND "closed_at" IS NOT NULL)),
    CONSTRAINT "client_needs_other_reason_comment_check" CHECK ("stop_reason_code" IS DISTINCT FROM 'other' OR ("stop_comment" IS NOT NULL AND length(trim("stop_comment")) > 0)),
    CONSTRAINT "client_needs_budget_range_check" CHECK ("budget_min" IS NULL OR "budget_max" IS NULL OR "budget_min" <= "budget_max"),
    CONSTRAINT "client_needs_area_range_check" CHECK ("area_min" IS NULL OR "area_max" IS NULL OR "area_min" <= "area_max"),
    CONSTRAINT "ClientNeed_budgetMin_exact" CHECK ("budget_min" IS NULL OR (typeof("budget_min") = 'integer' AND abs("budget_min") < 10000000000000000)),
    CONSTRAINT "ClientNeed_budgetMax_exact" CHECK ("budget_max" IS NULL OR (typeof("budget_max") = 'integer' AND abs("budget_max") < 10000000000000000)),
    CONSTRAINT "ClientNeed_areaMin_exact" CHECK ("area_min" IS NULL OR (typeof("area_min") = 'integer' AND abs("area_min") < 1000000000000)),
    CONSTRAINT "ClientNeed_areaMax_exact" CHECK ("area_max" IS NULL OR (typeof("area_max") = 'integer' AND abs("area_max") < 1000000000000)),
    CONSTRAINT "ClientNeed_landAreaMin_exact" CHECK ("land_area_min" IS NULL OR (typeof("land_area_min") = 'integer' AND abs("land_area_min") < 1000000000000)),
    CONSTRAINT "ClientNeed_landAreaMax_exact" CHECK ("land_area_max" IS NULL OR (typeof("land_area_max") = 'integer' AND abs("land_area_max") < 1000000000000)),
    CONSTRAINT "ClientNeed_buildingAreaMin_exact" CHECK ("building_area_min" IS NULL OR (typeof("building_area_min") = 'integer' AND abs("building_area_min") < 1000000000000)),
    CONSTRAINT "ClientNeed_buildingAreaMax_exact" CHECK ("building_area_max" IS NULL OR (typeof("building_area_max") = 'integer' AND abs("building_area_max") < 1000000000000)),
    CONSTRAINT "ClientNeed_powerRequirement_exact" CHECK ("power_requirement" IS NULL OR (typeof("power_requirement") = 'integer' AND abs("power_requirement") < 10000000000))
);

-- CreateTable
CREATE TABLE "need_stage_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "client_need_id" TEXT NOT NULL,
    "from_stage" TEXT,
    "to_stage" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT,
    "reason_code" TEXT,
    "comment" TEXT,
    "changed_by" TEXT NOT NULL,
    "occurred_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    CONSTRAINT "need_stage_history_client_need_id_fkey" FOREIGN KEY ("client_need_id") REFERENCES "client_needs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "need_stage_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "need_stage_history_to_stage_check" CHECK ("to_stage" IN ('new', 'qualification', 'selection', 'showing', 'negotiation', 'preliminary_agreement', 'documents', 'deal', 'postdeal')),
    CONSTRAINT "need_stage_history_from_stage_check" CHECK ("from_stage" IS NULL OR "from_stage" IN ('new', 'qualification', 'selection', 'showing', 'negotiation', 'preliminary_agreement', 'documents', 'deal', 'postdeal')),
    CONSTRAINT "need_stage_history_to_status_check" CHECK ("to_status" IS NULL OR "to_status" IN ('active', 'paused', 'success', 'closed')),
    CONSTRAINT "need_stage_history_from_status_check" CHECK ("from_status" IS NULL OR "from_status" IN ('active', 'paused', 'success', 'closed'))
);

-- CreateTable
CREATE TABLE "communications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "client_id" TEXT NOT NULL,
    "client_need_id" TEXT,
    "lead_request_id" TEXT,
    "author_user_id" TEXT NOT NULL,
    "communication_type" TEXT NOT NULL,
    "channel_code" TEXT,
    "occurred_at" DATETIME NOT NULL,
    "result_code" TEXT,
    "comment" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    CONSTRAINT "communications_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "communications_client_need_id_fkey" FOREIGN KEY ("client_need_id") REFERENCES "client_needs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "communications_lead_request_id_fkey" FOREIGN KEY ("lead_request_id") REFERENCES "lead_requests" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "communications_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "communications_communication_type_check" CHECK ("communication_type" IN ('call', 'message', 'email', 'meeting', 'other')),
    CONSTRAINT "communications_result_code_check" CHECK ("result_code" IS NULL OR "result_code" IN ('completed', 'no_answer', 'followup_required', 'client_refused', 'other'))
);

-- CreateTable
CREATE TABLE "properties" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "responsible_user_id" TEXT,
    "property_type" TEXT NOT NULL,
    "property_subtype" TEXT,
    "operation_type" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_platform_code" TEXT,
    "source_url" TEXT,
    "address_text" TEXT NOT NULL,
    "district" TEXT,
    "area" BIGINT,
    "floor" INTEGER,
    "floors_total" INTEGER,
    "rooms_count" INTEGER,
    "land_area" BIGINT,
    "building_area" BIGINT,
    "price" BIGINT,
    "commercial_purpose" TEXT,
    "power_kw" BIGINT,
    "parking_available" BOOLEAN,
    "has_tenant" BOOLEAN,
    "status" TEXT NOT NULL,
    "description" TEXT,
    "attributes_jsonb" JSONB,
    "archived_at" DATETIME,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "properties_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "properties_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "properties_source_type_check" CHECK ("source_type" IN ('agency_listing', 'external_market')),
    CONSTRAINT "properties_status_check" CHECK ("status" IN ('draft', 'active', 'paused', 'closed', 'archived')),
    CONSTRAINT "properties_price_check" CHECK ("price" IS NULL OR "price" >= 0),
    CONSTRAINT "Property_area_exact" CHECK ("area" IS NULL OR (typeof("area") = 'integer' AND abs("area") < 1000000000000)),
    CONSTRAINT "Property_landArea_exact" CHECK ("land_area" IS NULL OR (typeof("land_area") = 'integer' AND abs("land_area") < 1000000000000)),
    CONSTRAINT "Property_buildingArea_exact" CHECK ("building_area" IS NULL OR (typeof("building_area") = 'integer' AND abs("building_area") < 1000000000000)),
    CONSTRAINT "Property_price_exact" CHECK ("price" IS NULL OR (typeof("price") = 'integer' AND abs("price") < 10000000000000000)),
    CONSTRAINT "Property_powerKw_exact" CHECK ("power_kw" IS NULL OR (typeof("power_kw") = 'integer' AND abs("power_kw") < 10000000000))
);

-- CreateTable
CREATE TABLE "property_owners" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "property_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "owner_role" TEXT,
    "ownership_share" BIGINT,
    "comment" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    CONSTRAINT "property_owners_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "property_owners_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "property_owners_share_check" CHECK ("ownership_share" IS NULL OR ("ownership_share" > 0 AND "ownership_share" <= 10000)),
    CONSTRAINT "PropertyOwner_ownershipShare_exact" CHECK ("ownership_share" IS NULL OR (typeof("ownership_share") = 'integer' AND abs("ownership_share") < 10000000))
);

-- CreateTable
CREATE TABLE "need_property_matches" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "client_need_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "offered_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "source_code" TEXT,
    "status" TEXT NOT NULL,
    "rejection_reason_code" TEXT,
    "comment" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "need_property_matches_client_need_id_fkey" FOREIGN KEY ("client_need_id") REFERENCES "client_needs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "need_property_matches_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "need_property_matches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "need_property_matches_status_check" CHECK ("status" IN ('proposed', 'interested', 'rejected', 'showing_planned', 'withdrawn'))
);

-- CreateTable
CREATE TABLE "showings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "client_need_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "responsible_user_id" TEXT NOT NULL,
    "scheduled_at" DATETIME NOT NULL,
    "occurred_at" DATETIME,
    "status" TEXT NOT NULL,
    "result_code" TEXT,
    "comment" TEXT,
    "participants_text" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "showings_client_need_id_fkey" FOREIGN KEY ("client_need_id") REFERENCES "client_needs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "showings_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "showings_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "showings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "showings_status_check" CHECK ("status" IN ('planned', 'completed', 'cancelled', 'no_show')),
    CONSTRAINT "showings_result_code_check" CHECK ("result_code" IS NULL OR "result_code" IN ('interested', 'thinking', 'rejected', 'negotiation', 'other'))
);

-- CreateTable
CREATE TABLE "advertisements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "property_id" TEXT NOT NULL,
    "responsible_user_id" TEXT,
    "platform_code" TEXT NOT NULL,
    "url" TEXT,
    "ad_text" TEXT,
    "status" TEXT NOT NULL,
    "published_at" DATETIME,
    "last_checked_at" DATETIME,
    "expires_at" DATETIME,
    "comment" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "advertisements_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "advertisements_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "advertisements_status_check" CHECK ("status" IN ('draft', 'active', 'paused', 'expired', 'removed'))
);

-- CreateTable
CREATE TABLE "agreements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "client_id" TEXT,
    "property_id" TEXT,
    "deal_id" TEXT,
    "responsible_user_id" TEXT NOT NULL,
    "legal_entity_id" TEXT,
    "agreement_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "agreement_number" TEXT,
    "is_exclusive" BOOLEAN,
    "signed_at" DATETIME,
    "valid_from" DATETIME,
    "valid_until" DATETIME,
    "commission_type" TEXT,
    "commission_value" BIGINT,
    "commission_notes" TEXT,
    "absence_reason_code" TEXT,
    "action_required" TEXT,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    "archived_at" DATETIME,
    CONSTRAINT "agreements_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "agreements_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "agreements_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "agreements_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "agreements_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "agreements_status_check" CHECK ("status" IN ('draft', 'negotiating', 'signed', 'expired', 'terminated', 'declined', 'no_agreement', 'archived')),
    CONSTRAINT "agreements_agreement_type_check" CHECK ("agreement_type" IN ('information', 'exclusive', 'representation', 'lease_related', 'sale_related', 'other')),
    CONSTRAINT "agreements_link_required_check" CHECK ("client_id" IS NOT NULL OR "property_id" IS NOT NULL OR "deal_id" IS NOT NULL),
    CONSTRAINT "agreements_signed_date_check" CHECK ("status" <> 'signed' OR "signed_at" IS NOT NULL),
    CONSTRAINT "Agreement_commissionValue_exact" CHECK ("commission_value" IS NULL OR (typeof("commission_value") = 'integer' AND abs("commission_value") < 10000000000000000))
);

-- CreateTable
CREATE TABLE "tasks" (
    "recurrence_rule" TEXT,
    "reminder_offsets" JSONB NOT NULL DEFAULT '[]',
    "bulk_batch_id" TEXT,
    "id" TEXT NOT NULL PRIMARY KEY,
    "responsible_user_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "task_subtype_code" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_at" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "recurrence_kind" TEXT NOT NULL DEFAULT 'none',
    "recurrence_interval" INTEGER NOT NULL DEFAULT 1,
    "recurrence_until" DATETIME,
    "parent_task_id" TEXT,
    "completed_at" DATETIME,
    "result_comment" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "tasks_bulk_batch_id_fkey" FOREIGN KEY ("bulk_batch_id") REFERENCES "bulk_task_batches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tasks_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tasks_parent_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "tasks" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tasks_status_check" CHECK ("status" IN ('planned', 'in_progress', 'completed', 'cancelled')),
    CONSTRAINT "tasks_recurrence_kind_check" CHECK ("recurrence_kind" IN ('none', 'daily', 'weekly', 'monthly', 'yearly')),
    CONSTRAINT "tasks_postdeal_subtype_check" CHECK (("task_type" <> 'postdeal') OR ("task_subtype_code" IN ('tax_declaration', 'rent_indexation', 'invoice', 'acceptance_act', 'premises_return', 'followup', 'other'))),
    CONSTRAINT "tasks_recurrence_interval_check" CHECK ("recurrence_interval" >= 1),
    CONSTRAINT "tasks_completed_at_check" CHECK ("status" <> 'completed' OR "completed_at" IS NOT NULL),
    CONSTRAINT "tasks_task_type_check" CHECK ("task_type" IN ('pause_return', 'call_or_contact', 'showing_or_meeting', 'commercial_offer', 'document', 'advertising_check', 'contract_check', 'postdeal', 'other')),
    CONSTRAINT "tasks_priority_check" CHECK ("priority" IN ('low', 'normal', 'high', 'critical')),
    CONSTRAINT "Task_reminderOffsets_array" CHECK (json_valid("reminder_offsets") AND json_type("reminder_offsets") = 'array')
);

-- CreateTable
CREATE TABLE "task_clients" (
    "task_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,

    PRIMARY KEY ("task_id", "client_id"),
    CONSTRAINT "task_clients_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "task_clients_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "task_needs" (
    "task_id" TEXT NOT NULL,
    "client_need_id" TEXT NOT NULL,

    PRIMARY KEY ("task_id", "client_need_id"),
    CONSTRAINT "task_needs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "task_needs_client_need_id_fkey" FOREIGN KEY ("client_need_id") REFERENCES "client_needs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "task_properties" (
    "task_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,

    PRIMARY KEY ("task_id", "property_id"),
    CONSTRAINT "task_properties_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "task_properties_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "task_showings" (
    "task_id" TEXT NOT NULL,
    "showing_id" TEXT NOT NULL,

    PRIMARY KEY ("task_id", "showing_id"),
    CONSTRAINT "task_showings_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "task_showings_showing_id_fkey" FOREIGN KEY ("showing_id") REFERENCES "showings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "task_deals" (
    "task_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,

    PRIMARY KEY ("task_id", "deal_id"),
    CONSTRAINT "task_deals_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "task_deals_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "task_advertisements" (
    "task_id" TEXT NOT NULL,
    "advertisement_id" TEXT NOT NULL,

    PRIMARY KEY ("task_id", "advertisement_id"),
    CONSTRAINT "task_advertisements_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "task_advertisements_advertisement_id_fkey" FOREIGN KEY ("advertisement_id") REFERENCES "advertisements" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "task_agreements" (
    "task_id" TEXT NOT NULL,
    "agreement_id" TEXT NOT NULL,

    PRIMARY KEY ("task_id", "agreement_id"),
    CONSTRAINT "task_agreements_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "task_agreements_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreements" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "task_commercial_offers" (
    "task_id" TEXT NOT NULL,
    "commercial_offer_id" TEXT NOT NULL,

    PRIMARY KEY ("task_id", "commercial_offer_id"),
    CONSTRAINT "task_commercial_offers_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "task_commercial_offers_commercial_offer_id_fkey" FOREIGN KEY ("commercial_offer_id") REFERENCES "commercial_offers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "legal_entities" (
    "logo_document_id" TEXT,
    "requisites" TEXT,
    "id" TEXT NOT NULL PRIMARY KEY,
    "entity_type" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "legal_entities_logo_document_id_fkey" FOREIGN KEY ("logo_document_id") REFERENCES "documents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "legal_entities_entity_type_check" CHECK ("entity_type" IN ('IP', 'LLC'))
);

-- CreateTable
CREATE TABLE "deals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "property_id" TEXT NOT NULL,
    "responsible_user_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "opened_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "preliminary_agreement_at" DATETIME,
    "main_agreement_at" DATETIME,
    "registration_at" DATETIME,
    "closed_at" DATETIME,
    "deal_price" BIGINT,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "deals_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deals_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deals_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deals_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deals_status_check" CHECK ("status" IN ('draft', 'preliminary_agreement', 'documents', 'registration', 'completed', 'cancelled')),
    CONSTRAINT "deals_price_check" CHECK ("deal_price" IS NULL OR "deal_price" >= 0),
    CONSTRAINT "Deal_dealPrice_exact" CHECK ("deal_price" IS NULL OR (typeof("deal_price") = 'integer' AND abs("deal_price") < 10000000000000000))
);

-- CreateTable
CREATE TABLE "deal_parties" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deal_id" TEXT NOT NULL,
    "client_id" TEXT,
    "external_party_name" TEXT,
    "party_role" TEXT NOT NULL,
    "comment" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    CONSTRAINT "deal_parties_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deal_parties_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deal_parties_party_role_check" CHECK ("party_role" IN ('buyer', 'seller', 'tenant', 'landlord', 'other')),
    CONSTRAINT "deal_parties_party_check" CHECK ("client_id" IS NOT NULL OR ("external_party_name" IS NOT NULL AND length(trim("external_party_name")) > 0))
);

-- CreateTable
CREATE TABLE "deal_commissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deal_id" TEXT NOT NULL,
    "payer_party_id" TEXT,
    "amount" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "due_at" DATETIME,
    "received_at" DATETIME,
    "comment" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "deal_commissions_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deal_commissions_payer_party_id_fkey" FOREIGN KEY ("payer_party_id") REFERENCES "deal_parties" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deal_commissions_status_check" CHECK ("status" IN ('planned', 'due', 'partially_received', 'received', 'waived', 'cancelled')),
    CONSTRAINT "deal_commissions_amount_check" CHECK ("amount" >= 0),
    CONSTRAINT "DealCommission_amount_exact" CHECK ("amount" IS NULL OR (typeof("amount") = 'integer' AND abs("amount") < 10000000000000000))
);

-- CreateTable
CREATE TABLE "commercial_offers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "client_need_id" TEXT NOT NULL,
    "responsible_user_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "legal_entity_id" TEXT,
    "status" TEXT NOT NULL,
    "title" TEXT,
    "intro_text" TEXT,
    "notes" TEXT,
    "generation_source" TEXT NOT NULL DEFAULT 'manual',
    "prompt_template_version" TEXT,
    "sent_at" DATETIME,
    "expires_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "commercial_offers_client_need_id_fkey" FOREIGN KEY ("client_need_id") REFERENCES "client_needs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "commercial_offers_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "commercial_offers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "commercial_offers_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "commercial_offers_status_check" CHECK ("status" IN ('draft', 'prepared', 'sent', 'accepted', 'rejected', 'expired', 'archived')),
    CONSTRAINT "commercial_offers_generation_source_check" CHECK ("generation_source" IN ('manual', 'template', 'ai_assisted'))
);

-- CreateTable
CREATE TABLE "commercial_offer_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "commercial_offer_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "price_snapshot" BIGINT,
    "address_snapshot" TEXT,
    "area_snapshot" BIGINT,
    "terms_snapshot" TEXT,
    "comment" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    CONSTRAINT "commercial_offer_items_commercial_offer_id_fkey" FOREIGN KEY ("commercial_offer_id") REFERENCES "commercial_offers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "commercial_offer_items_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "commercial_offer_items_position_check" CHECK ("position" >= 1),
    CONSTRAINT "CommercialOfferItem_priceSnapshot_exact" CHECK ("price_snapshot" IS NULL OR (typeof("price_snapshot") = 'integer' AND abs("price_snapshot") < 10000000000000000)),
    CONSTRAINT "CommercialOfferItem_areaSnapshot_exact" CHECK ("area_snapshot" IS NULL OR (typeof("area_snapshot") = 'integer' AND abs("area_snapshot") < 1000000000000))
);

-- CreateTable
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
    CONSTRAINT "documents_document_type_code_check" CHECK ("document_type_code" IN ('agreement', 'title_document', 'commercial_offer', 'act', 'invoice', 'photo', 'other')),
    CONSTRAINT "documents_file_size_check" CHECK ("file_size" >= 0)
);

-- CreateTable
CREATE TABLE "document_clients" (
    "document_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,

    PRIMARY KEY ("document_id", "client_id"),
    CONSTRAINT "document_clients_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "document_clients_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "document_needs" (
    "document_id" TEXT NOT NULL,
    "client_need_id" TEXT NOT NULL,

    PRIMARY KEY ("document_id", "client_need_id"),
    CONSTRAINT "document_needs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "document_needs_client_need_id_fkey" FOREIGN KEY ("client_need_id") REFERENCES "client_needs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "document_properties" (
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_cover" BOOLEAN NOT NULL DEFAULT false,
    "caption" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'document',
    "archived_at" DATETIME,
    "document_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,

    PRIMARY KEY ("document_id", "property_id"),
    CONSTRAINT "document_properties_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "document_properties_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "document_properties_kind_check" CHECK ("kind" IN ('photo', 'document')),
    CONSTRAINT "document_properties_cover_photo_check" CHECK (NOT is_cover OR (kind = 'photo' AND archived_at IS NULL))
);

-- CreateTable
CREATE TABLE "document_showings" (
    "document_id" TEXT NOT NULL,
    "showing_id" TEXT NOT NULL,

    PRIMARY KEY ("document_id", "showing_id"),
    CONSTRAINT "document_showings_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "document_showings_showing_id_fkey" FOREIGN KEY ("showing_id") REFERENCES "showings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "document_deals" (
    "document_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,

    PRIMARY KEY ("document_id", "deal_id"),
    CONSTRAINT "document_deals_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "document_deals_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "document_advertisements" (
    "document_id" TEXT NOT NULL,
    "advertisement_id" TEXT NOT NULL,

    PRIMARY KEY ("document_id", "advertisement_id"),
    CONSTRAINT "document_advertisements_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "document_advertisements_advertisement_id_fkey" FOREIGN KEY ("advertisement_id") REFERENCES "advertisements" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "document_agreements" (
    "document_id" TEXT NOT NULL,
    "agreement_id" TEXT NOT NULL,

    PRIMARY KEY ("document_id", "agreement_id"),
    CONSTRAINT "document_agreements_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "document_agreements_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreements" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "document_commercial_offers" (
    "document_id" TEXT NOT NULL,
    "commercial_offer_id" TEXT NOT NULL,

    PRIMARY KEY ("document_id", "commercial_offer_id"),
    CONSTRAINT "document_commercial_offers_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "document_commercial_offers_commercial_offer_id_fkey" FOREIGN KEY ("commercial_offer_id") REFERENCES "commercial_offers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "historical_deal_archive" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source_file" TEXT NOT NULL,
    "source_row_id" TEXT,
    "source_row_key" TEXT NOT NULL,
    "deal_date" DATETIME,
    "deal_date_text" TEXT,
    "participant_name" TEXT,
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "property_type" TEXT,
    "object_text" TEXT,
    "party_role" TEXT,
    "area" BIGINT,
    "price" BIGINT,
    "conditions" TEXT,
    "realtor_text" TEXT,
    "contract_ref" TEXT,
    "commission_amount" BIGINT,
    "additional_info" TEXT,
    "client_id" TEXT,
    "import_job_id" TEXT,
    "imported_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    CONSTRAINT "historical_deal_archive_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "historical_deal_archive_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "import_jobs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "HistoricalDealArchive_area_exact" CHECK ("area" IS NULL OR (typeof("area") = 'integer' AND abs("area") < 1000000000000)),
    CONSTRAINT "HistoricalDealArchive_price_exact" CHECK ("price" IS NULL OR (typeof("price") = 'integer' AND abs("price") < 10000000000000000)),
    CONSTRAINT "HistoricalDealArchive_commissionAmount_exact" CHECK ("commission_amount" IS NULL OR (typeof("commission_amount") = 'integer' AND abs("commission_amount") < 10000000000000000))
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source_filename" TEXT NOT NULL,
    "source_sha256" TEXT NOT NULL,
    "source_format" TEXT NOT NULL,
    "profile_code" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_by" TEXT NOT NULL,
    "started_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "finished_at" DATETIME,
    "rows_read" INTEGER NOT NULL DEFAULT 0,
    "rows_imported" INTEGER NOT NULL DEFAULT 0,
    "rows_skipped" INTEGER NOT NULL DEFAULT 0,
    "rows_error" INTEGER NOT NULL DEFAULT 0,
    "probable_duplicates" INTEGER NOT NULL DEFAULT 0,
    "mapping_version" TEXT NOT NULL,
    "report_storage_key" TEXT,
    "source_storage_key" TEXT,
    "summary_jsonb" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "import_jobs_started_by_fkey" FOREIGN KEY ("started_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "import_jobs_status_check" CHECK ("status" IN ('uploaded', 'parsing', 'dry_run_ready', 'dry_run_failed', 'committing', 'completed', 'completed_with_errors', 'failed', 'cancelled')),
    CONSTRAINT "import_jobs_counters_check" CHECK ("rows_read" >= 0 AND "rows_imported" >= 0 AND "rows_skipped" >= 0 AND "rows_error" >= 0 AND "probable_duplicates" >= 0)
);

-- CreateTable
CREATE TABLE "import_row_results" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "import_job_id" TEXT NOT NULL,
    "sheet_name" TEXT,
    "source_section" TEXT,
    "source_row_number" INTEGER,
    "source_record_key" TEXT,
    "target_entity_type" TEXT,
    "target_entity_id" TEXT,
    "validation_status" TEXT NOT NULL,
    "commit_result" TEXT,
    "error_codes" JSONB NOT NULL DEFAULT '[]',
    "warning_codes" JSONB NOT NULL DEFAULT '[]',
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    CONSTRAINT "import_row_results_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "import_jobs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "import_row_results_validation_status_check" CHECK ("validation_status" IN ('ready', 'warning', 'skipped_policy', 'invalid', 'unrecognized')),
    CONSTRAINT "import_row_results_commit_result_check" CHECK ("commit_result" IS NULL OR "commit_result" IN ('imported', 'skipped', 'error')),
    CONSTRAINT "ImportRowResult_errorCodes_array" CHECK (json_valid("error_codes") AND json_type("error_codes") = 'array'),
    CONSTRAINT "ImportRowResult_warningCodes_array" CHECK (json_valid("warning_codes") AND json_type("warning_codes") = 'array')
);

-- CreateTable
CREATE TABLE "backup_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "backup_id" TEXT NOT NULL,
    "deployment_id" TEXT NOT NULL,
    "started_at" DATETIME NOT NULL,
    "finished_at" DATETIME,
    "initiated_by_user_id" TEXT,
    "trigger_type" TEXT NOT NULL,
    "local_status" TEXT NOT NULL,
    "database_dump_size" BIGINT,
    "files_archive_size" BIGINT,
    "manifest_sha256" TEXT,
    "app_version" TEXT,
    "schema_version" TEXT,
    "error_summary" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    CONSTRAINT "backup_runs_initiated_by_user_id_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "backup_runs_trigger_type_check" CHECK ("trigger_type" IN ('scheduled', 'manual', 'pre_update', 'pre_migration', 'shutdown')),
    CONSTRAINT "backup_runs_local_status_check" CHECK ("local_status" IN ('pending', 'running', 'success', 'failed'))
);

-- CreateTable
CREATE TABLE "backup_remotes" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "last_probe_at" DATETIME,
    "probe_status" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "backup_remotes_provider_type_check" CHECK ("provider_type" IN ('yandex_s3', 'mailru_webdav', 'sberdisk_compat', 'filesystem', 'other')),
    CONSTRAINT "backup_remotes_transport_type_check" CHECK ("transport_type" IN ('s3', 'webdav', 'filesystem', 'other'))
);

-- CreateTable
CREATE TABLE "backup_target_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "backup_run_id" TEXT NOT NULL,
    "backup_remote_id" TEXT NOT NULL,
    "upload_status" TEXT NOT NULL,
    "verify_status" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" DATETIME,
    "finished_at" DATETIME,
    "verified_at" DATETIME,
    "bytes_uploaded" BIGINT,
    "remote_backup_ref" TEXT,
    "error_code" TEXT,
    "error_summary" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "backup_target_runs_backup_run_id_fkey" FOREIGN KEY ("backup_run_id") REFERENCES "backup_runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "backup_target_runs_backup_remote_id_fkey" FOREIGN KEY ("backup_remote_id") REFERENCES "backup_remotes" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "backup_target_runs_upload_status_check" CHECK ("upload_status" IN ('pending', 'uploading', 'uploaded', 'failed', 'skipped')),
    CONSTRAINT "backup_target_runs_verify_status_check" CHECK ("verify_status" IN ('not_verified', 'verifying', 'verified', 'failed'))
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor_user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "occurred_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "before_jsonb" JSONB,
    "after_jsonb" JSONB,
    "correlation_id" TEXT,
    CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ai_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider_code" TEXT NOT NULL,
    "feature_code" TEXT NOT NULL,
    "model_code" TEXT,
    "requested_by_user_id" TEXT NOT NULL,
    "target_entity_type" TEXT,
    "target_entity_id" TEXT,
    "prompt_template_version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" DATETIME,
    "finished_at" DATETIME,
    "input_units" BIGINT,
    "output_units" BIGINT,
    "estimated_cost" BIGINT,
    "output_document_id" TEXT,
    "error_code" TEXT,
    "error_summary" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    CONSTRAINT "ai_runs_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ai_runs_output_document_id_fkey" FOREIGN KEY ("output_document_id") REFERENCES "documents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiRun_estimatedCost_exact" CHECK ("estimated_cost" IS NULL OR (typeof("estimated_cost") = 'integer' AND abs("estimated_cost") < 10000000000000000))
);

-- CreateTable
CREATE TABLE "dictionary_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "external_listings" (
    "published_at" DATETIME,
    "source_updated_at" DATETIME,
    "date_source" TEXT NOT NULL DEFAULT 'unknown',
    "date_precision" TEXT NOT NULL DEFAULT 'unknown',
    "source_category_raw" TEXT,
    "purpose_evidence" JSONB,
    "price_per_m2_rub" BIGINT,
    "price_per_m2_unit" TEXT,
    "fetched_at" DATETIME,
    "last_checked_at" DATETIME,
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "source_listing_id" TEXT,
    "source_unit_id" TEXT,
    "url" TEXT NOT NULL,
    "source_method" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "price_rub" BIGINT,
    "price_unit" TEXT NOT NULL,
    "area_m2" BIGINT,
    "floor_raw" TEXT,
    "floor_number" INTEGER,
    "purposes" JSONB NOT NULL DEFAULT '[]',
    "address" TEXT,
    "district" TEXT,
    "city" TEXT NOT NULL DEFAULT 'Новосибирск',
    "seller_type" TEXT,
    "owner_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "owner_confirmation_method" TEXT,
    "owner_confirmed_at" DATETIME,
    "owner_confirmation_source" TEXT,
    "description" TEXT,
    "images" JSONB NOT NULL DEFAULT '[]',
    "first_seen_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "last_seen_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "last_price" BIGINT,
    "property_id" TEXT,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "external_listings_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "external_listings_source_check" CHECK ("source" IN ('cian', 'mirkvartir', 'onrealt', 'domclick', 'yandex', 'youla', 'avito', 'web_search', 'manual')),
    CONSTRAINT "external_listings_source_method_check" CHECK ("source_method" IN ('scraper', 'web_search', 'manual')),
    CONSTRAINT "external_listings_operation_check" CHECK ("operation" IN ('sale', 'rent')),
    CONSTRAINT "external_listings_price_unit_check" CHECK ("price_unit" IN ('total', 'per_month', 'per_m2', 'per_m2_month', 'per_year', 'per_m2_year')),
    CONSTRAINT "external_listings_values_check" CHECK (
  (price_rub IS NULL OR price_rub >= 0) AND (last_price IS NULL OR last_price >= 0)
  AND (area_m2 IS NULL OR area_m2 > 0) AND last_seen_at >= first_seen_at
  AND json_type(images) = 'array'
  AND (NOT owner_confirmed OR (owner_confirmed_at IS NOT NULL
    AND nullif(trim(owner_confirmation_method), '') IS NOT NULL
    AND nullif(trim(owner_confirmation_source), '') IS NOT NULL))),
    CONSTRAINT "external_listings_date_source_check" CHECK ("date_source" IN ('site_published', 'site_updated', 'relative_label', 'first_seen', 'unknown')),
    CONSTRAINT "external_listings_date_precision_check" CHECK ("date_precision" IN ('exact', 'day', 'relative', 'unknown')),
    CONSTRAINT "external_listings_price_per_m2_unit_check" CHECK ("price_per_m2_unit" IS NULL OR "price_per_m2_unit" IN ('per_m2', 'per_m2_month', 'per_m2_year')),
    CONSTRAINT "external_listings_price_per_m2_check" CHECK (("price_per_m2_rub" IS NULL AND "price_per_m2_unit" IS NULL) OR ("price_per_m2_rub" IS NOT NULL AND "price_per_m2_rub" >= 0 AND "price_per_m2_unit" IS NOT NULL)),
    CONSTRAINT "ExternalListing_pricePerM2Rub_exact" CHECK ("price_per_m2_rub" IS NULL OR (typeof("price_per_m2_rub") = 'integer' AND abs("price_per_m2_rub") < 10000000000000000)),
    CONSTRAINT "ExternalListing_priceRub_exact" CHECK ("price_rub" IS NULL OR (typeof("price_rub") = 'integer' AND abs("price_rub") < 10000000000000000)),
    CONSTRAINT "ExternalListing_areaM2_exact" CHECK ("area_m2" IS NULL OR (typeof("area_m2") = 'integer' AND abs("area_m2") < 1000000000000)),
    CONSTRAINT "ExternalListing_lastPrice_exact" CHECK ("last_price" IS NULL OR (typeof("last_price") = 'integer' AND abs("last_price") < 10000000000000000)),
    CONSTRAINT "ExternalListing_purposes_array" CHECK (json_valid("purposes") AND json_type("purposes") = 'array')
);

-- CreateTable
CREATE TABLE "external_listing_snapshots" (
    "published_at" DATETIME,
    "source_updated_at" DATETIME,
    "date_source" TEXT NOT NULL DEFAULT 'unknown',
    "date_precision" TEXT NOT NULL DEFAULT 'unknown',
    "source_category_raw" TEXT,
    "purpose_evidence" JSONB,
    "price_per_m2_rub" BIGINT,
    "price_per_m2_unit" TEXT,
    "first_seen_at" DATETIME,
    "last_seen_at" DATETIME,
    "area_m2" BIGINT,
    "last_checked_at" DATETIME,
    "id" TEXT NOT NULL PRIMARY KEY,
    "listing_id" TEXT NOT NULL,
    "search_run_id" TEXT,
    "fetched_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "price_rub" BIGINT,
    "normalized" JSONB NOT NULL,
    CONSTRAINT "external_listing_snapshots_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "external_listings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "external_listing_snapshots_search_run_id_fkey" FOREIGN KEY ("search_run_id") REFERENCES "search_runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "external_listing_snapshots_values_check" CHECK ((price_rub IS NULL OR price_rub >= 0) AND json_type(normalized) = 'object'),
    CONSTRAINT "external_listing_snapshots_date_source_check" CHECK ("date_source" IN ('site_published', 'site_updated', 'relative_label', 'first_seen', 'unknown')),
    CONSTRAINT "external_listing_snapshots_date_precision_check" CHECK ("date_precision" IN ('exact', 'day', 'relative', 'unknown')),
    CONSTRAINT "external_listing_snapshots_price_per_m2_unit_check" CHECK ("price_per_m2_unit" IS NULL OR "price_per_m2_unit" IN ('per_m2', 'per_m2_month', 'per_m2_year')),
    CONSTRAINT "external_listing_snapshots_price_per_m2_check" CHECK (("price_per_m2_rub" IS NULL AND "price_per_m2_unit" IS NULL) OR ("price_per_m2_rub" IS NOT NULL AND "price_per_m2_rub" >= 0 AND "price_per_m2_unit" IS NOT NULL)),
    CONSTRAINT "ExternalListingSnapshot_pricePerM2Rub_exact" CHECK ("price_per_m2_rub" IS NULL OR (typeof("price_per_m2_rub") = 'integer' AND abs("price_per_m2_rub") < 10000000000000000)),
    CONSTRAINT "ExternalListingSnapshot_areaM2_exact" CHECK ("area_m2" IS NULL OR (typeof("area_m2") = 'integer' AND abs("area_m2") < 1000000000000)),
    CONSTRAINT "ExternalListingSnapshot_priceRub_exact" CHECK ("price_rub" IS NULL OR (typeof("price_rub") = 'integer' AND abs("price_rub") < 10000000000000000))
);

-- CreateTable
CREATE TABLE "external_listing_verifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listing_id" TEXT NOT NULL,
    "verified_by" TEXT NOT NULL,
    "verified_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "availability" TEXT NOT NULL DEFAULT 'unknown',
    "price_confirmed" BOOLEAN,
    "owner_confirmed" BOOLEAN,
    "note" TEXT,
    "next_check_at" DATETIME,
    CONSTRAINT "external_listing_verifications_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "external_listings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "external_listing_verifications_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "external_listing_verifications_availability_check" CHECK ("availability" IN ('available', 'reserved', 'withdrawn', 'unknown'))
);

-- CreateTable
CREATE TABLE "search_bookmarks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'study',
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "search_bookmarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "search_bookmarks_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "external_listings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "search_bookmarks_status_check" CHECK ("status" IN ('study', 'clarify', 'exclude'))
);

-- CreateTable
CREATE TABLE "search_selections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "need_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "added_by" TEXT NOT NULL,
    "comment" TEXT,
    "review_status" TEXT NOT NULL DEFAULT 'candidate',
    "property_id" TEXT,
    "match_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "search_selections_need_id_fkey" FOREIGN KEY ("need_id") REFERENCES "client_needs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "search_selections_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "external_listings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "search_selections_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "search_selections_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "search_selections_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "need_property_matches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "search_selections_review_status_check" CHECK ("review_status" IN ('candidate', 'shortlisted', 'rejected', 'proposed'))
);

-- CreateTable
CREATE TABLE "saved_searches" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT 'Новосибирск',
    "filters" JSONB NOT NULL,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "need_id" TEXT,
    "last_run_at" DATETIME,
    "last_successful_run_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "saved_searches_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "saved_searches_need_id_fkey" FOREIGN KEY ("need_id") REFERENCES "client_needs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "saved_searches_last_successful_run_id_fkey" FOREIGN KEY ("last_successful_run_id") REFERENCES "search_runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SavedSearch_sources_array" CHECK (json_valid("sources") AND json_type("sources") = 'array')
);

-- CreateTable
CREATE TABLE "search_runs" (
    "depth_params" JSONB NOT NULL DEFAULT '{}',
    "sort_params" JSONB NOT NULL DEFAULT '{}',
    "deadline_at" DATETIME,
    "cancelled_at" DATETIME,
    "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
    "progress" JSONB NOT NULL DEFAULT '{}',
    "incomplete_reason" TEXT,
    "idempotency_key" TEXT,
    "locked_by" TEXT,
    "heartbeat_at" DATETIME,
    "id" TEXT NOT NULL PRIMARY KEY,
    "saved_search_id" TEXT,
    "need_id" TEXT,
    "user_id" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT 'Новосибирск',
    "filters" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "started_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "finished_at" DATETIME,
    "web_search_used" BOOLEAN NOT NULL DEFAULT false,
    "fallback_reason" TEXT,
    CONSTRAINT "search_runs_saved_search_id_fkey" FOREIGN KEY ("saved_search_id") REFERENCES "saved_searches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "search_runs_need_id_fkey" FOREIGN KEY ("need_id") REFERENCES "client_needs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "search_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "search_runs_dates_check" CHECK (finished_at IS NULL OR finished_at >= started_at),
    CONSTRAINT "search_runs_status_check" CHECK ("status" IN ('queued', 'needs_user_action', 'completed', 'failed', 'pending', 'running', 'success', 'partial', 'error', 'cancelled'))
);

-- CreateTable
CREATE TABLE "search_run_sources" (
    "requested_count" INTEGER NOT NULL DEFAULT 0,
    "received_count" INTEGER NOT NULL DEFAULT 0,
    "accepted_count" INTEGER NOT NULL DEFAULT 0,
    "depth_reached" INTEGER NOT NULL DEFAULT 0,
    "retry_after_at" DATETIME,
    "status_reason_ru" TEXT,
    "needs_user_action" BOOLEAN NOT NULL DEFAULT false,
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "result_count" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "duration_ms" INTEGER,
    CONSTRAINT "search_run_sources_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "search_runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "search_run_sources_source_check" CHECK ("source" IN ('cian', 'mirkvartir', 'onrealt', 'domclick', 'yandex', 'youla', 'avito', 'web_search', 'manual')),
    CONSTRAINT "search_run_sources_counts_check" CHECK (result_count >= 0 AND (duration_ms IS NULL OR duration_ms >= 0)),
    CONSTRAINT "search_run_sources_status_check" CHECK ("status" IN ('queued', 'running', 'needs_user_action', 'completed', 'failed', 'cancelled', 'success', 'partial', 'blocked', 'timeout', 'unsupported_filter', 'error', 'disabled')),
    CONSTRAINT "search_run_sources_v31_counts_check" CHECK ("requested_count" >= 0 AND "received_count" >= 0 AND "accepted_count" >= 0 AND "depth_reached" >= 0 AND ("duration_ms" IS NULL OR "duration_ms" >= 0))
);

-- CreateTable
CREATE TABLE "search_run_results" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "criteria" JSONB NOT NULL DEFAULT '[]',
    "score" BIGINT NOT NULL DEFAULT 0,
    "is_new" BOOLEAN NOT NULL DEFAULT false,
    "price_changed" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "search_run_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "search_runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "search_run_results_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "external_listings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "search_run_results_verdict_check" CHECK ("verdict" IN ('confirmed', 'needs_review', 'rejected')),
    CONSTRAINT "search_run_results_criteria_check" CHECK (json_type(criteria) = 'array'),
    CONSTRAINT "SearchRunResult_score_exact" CHECK ("score" IS NULL OR (typeof("score") = 'integer' AND abs("score") < 10000000000000000))
);

-- CreateTable
CREATE TABLE "ai_settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ai_enabled" BOOLEAN NOT NULL DEFAULT false,
    "scraper_enabled" BOOLEAN NOT NULL DEFAULT false,
    "browser_enabled" BOOLEAN NOT NULL DEFAULT true,
    "enabled_sources" JSONB NOT NULL DEFAULT '[]',
    "web_search_manual_allowed" BOOLEAN NOT NULL DEFAULT false,
    "web_search_auto_fallback" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT NOT NULL DEFAULT 'aliceai-llm-flash/latest',
    "web_model" TEXT,
    "search_context_size" TEXT NOT NULL DEFAULT 'low',
    "per_user_daily_limit" INTEGER NOT NULL DEFAULT 3,
    "per_job_limit" INTEGER NOT NULL DEFAULT 1,
    "daily_limit" INTEGER NOT NULL DEFAULT 10,
    "monthly_budget_rub" BIGINT NOT NULL DEFAULT 100000,
    "updated_by" TEXT,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "ai_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ai_settings_search_context_size_check" CHECK ("search_context_size" IN ('low', 'medium', 'high')),
    CONSTRAINT "ai_settings_limits_check" CHECK (
  per_user_daily_limit >= 0 AND per_job_limit >= 0 AND daily_limit >= 0 AND monthly_budget_rub >= 0),
    CONSTRAINT "AiSetting_monthlyBudgetRub_exact" CHECK ("monthly_budget_rub" IS NULL OR (typeof("monthly_budget_rub") = 'integer' AND abs("monthly_budget_rub") < 10000000000000000)),
    CONSTRAINT "AiSetting_enabledSources_array" CHECK (json_valid("enabled_sources") AND json_type("enabled_sources") = 'array')
);

-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "call_type" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "search_run_id" TEXT,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "web_search_calls" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost_rub" BIGINT NOT NULL DEFAULT 0,
    "actual_cost_rub" BIGINT,
    "result" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "duration_ms" INTEGER,
    CONSTRAINT "ai_usage_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ai_usage_logs_search_run_id_fkey" FOREIGN KEY ("search_run_id") REFERENCES "search_runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ai_usage_logs_status_check" CHECK ("status" IN ('pending', 'running', 'success', 'error', 'cancelled')),
    CONSTRAINT "ai_usage_logs_counts_check" CHECK (
  input_tokens >= 0 AND output_tokens >= 0 AND web_search_calls >= 0 AND estimated_cost_rub >= 0
  AND (actual_cost_rub IS NULL OR actual_cost_rub >= 0) AND (duration_ms IS NULL OR duration_ms >= 0)),
    CONSTRAINT "ai_usage_logs_call_type_check" CHECK ("call_type" IN ('parse','description','web_search','call_note','offer_text','chat','chat_web')),
    CONSTRAINT "AiUsageLog_estimatedCostRub_exact" CHECK ("estimated_cost_rub" IS NULL OR (typeof("estimated_cost_rub") = 'integer' AND abs("estimated_cost_rub") < 10000000000000000)),
    CONSTRAINT "AiUsageLog_actualCostRub_exact" CHECK ("actual_cost_rub" IS NULL OR (typeof("actual_cost_rub") = 'integer' AND abs("actual_cost_rub") < 10000000000000000))
);

-- CreateTable
CREATE TABLE "ai_tariffs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "model" TEXT NOT NULL,
    "call_type" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "price_rub" BIGINT NOT NULL,
    "effective_from" DATETIME NOT NULL,
    CONSTRAINT "ai_tariffs_unit_check" CHECK ("unit" IN ('input_token', 'output_token', 'input_million_tokens', 'output_million_tokens', 'web_search_call')),
    CONSTRAINT "ai_tariffs_price_check" CHECK (price_rub >= 0),
    CONSTRAINT "ai_tariffs_call_type_check" CHECK ("call_type" IN ('parse','description','web_search','call_note','offer_text','chat','chat_web')),
    CONSTRAINT "AiTariff_priceRub_exact" CHECK ("price_rub" IS NULL OR (typeof("price_rub") = 'integer' AND abs("price_rub") < 10000000000000000))
);

-- CreateTable
CREATE TABLE "ai_budget_reservations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "usage_log_id" TEXT,
    "amount_rub" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    CONSTRAINT "ai_budget_reservations_usage_log_id_fkey" FOREIGN KEY ("usage_log_id") REFERENCES "ai_usage_logs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ai_budget_reservations_status_check" CHECK ("status" IN ('reserved', 'settled', 'released')),
    CONSTRAINT "ai_budget_reservations_amount_check" CHECK (amount_rub >= 0),
    CONSTRAINT "AiBudgetReservation_amountRub_exact" CHECK ("amount_rub" IS NULL OR (typeof("amount_rub") = 'integer' AND abs("amount_rub") < 10000000000000000))
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "start_at" DATETIME NOT NULL,
    "end_at" DATETIME NOT NULL,
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "owner_user_id" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "recurrence_rule" TEXT,
    "client_id" TEXT,
    "need_id" TEXT,
    "property_id" TEXT,
    "deal_id" TEXT,
    "archived_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "calendar_events_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "calendar_events_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "calendar_events_need_id_fkey" FOREIGN KEY ("need_id") REFERENCES "client_needs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "calendar_events_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "calendar_events_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "calendar_events_visibility_check" CHECK ("visibility" IN ('public', 'private')),
    CONSTRAINT "calendar_events_interval_check" CHECK (end_at > start_at)
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipient_user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "trigger_at" DATETIME NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "read_at" DATETIME,
    "snoozed_until" DATETIME,
    "title" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "dedup_key" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "notifications_state_check" CHECK ("state" IN ('pending', 'delivered', 'read', 'dismissed')),
    CONSTRAINT "notifications_kind_check" CHECK ("kind" IN ('task', 'assignment', 'showing', 'agreement', 'pause_return', 'annual_contact', 'postdeal', 'calendar_event')),
    CONSTRAINT "notifications_source_type_check" CHECK ("source_type" IN ('task', 'showing', 'agreement', 'calendar_event'))
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "lead_minutes" INTEGER NOT NULL DEFAULT 15,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "notification_preferences_lead_check" CHECK (lead_minutes >= 0)
);

-- CreateTable
CREATE TABLE "deal_checklist_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deal_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'none',
    "responsible_user_id" TEXT NOT NULL,
    "checked_at" DATETIME,
    "document_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "deal_checklist_items_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deal_checklist_items_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deal_checklist_items_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deal_checklist_items_status_check" CHECK ("status" IN ('none', 'review', 'verified', 'not_required'))
);

-- CreateTable
CREATE TABLE "interactive_browser_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "search_run_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "start_url_host" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "expires_at" DATETIME NOT NULL,
    "completed_at" DATETIME,
    "last_activity_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "close_reason" TEXT,
    CONSTRAINT "interactive_browser_sessions_search_run_id_fkey" FOREIGN KEY ("search_run_id") REFERENCES "search_runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "interactive_browser_sessions_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "interactive_browser_sessions_source_check" CHECK ("source" IN ('cian', 'mirkvartir', 'onrealt', 'domclick', 'yandex', 'youla', 'avito', 'web_search', 'manual')),
    CONSTRAINT "interactive_browser_sessions_status_check" CHECK ("status" IN ('pending', 'active', 'completed', 'cancelled', 'expired', 'failed')),
    CONSTRAINT "interactive_browser_sessions_interval_check" CHECK ("expires_at" > "created_at"),
    CONSTRAINT "interactive_browser_sessions_host_check" CHECK (length("start_url_host") BETWEEN 1 AND 253 AND "start_url_host" NOT GLOB '*[^A-Za-z0-9.-]*' AND substr("start_url_host",1,1) GLOB '[A-Za-z0-9]' AND substr("start_url_host",-1,1) GLOB '[A-Za-z0-9]')
);

-- CreateTable
CREATE TABLE "listing_duplicate_groups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'probable',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "listing_duplicate_groups_status_check" CHECK ("status" IN ('auto_exact', 'probable', 'confirmed', 'rejected', 'deferred'))
);

-- CreateTable
CREATE TABLE "listing_duplicate_members" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "group_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "released_at" DATETIME,
    CONSTRAINT "listing_duplicate_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "listing_duplicate_groups" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "listing_duplicate_members_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "external_listings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "listing_duplicate_decisions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "group_id" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "decided_by" TEXT NOT NULL,
    "decided_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "comment" TEXT,
    CONSTRAINT "listing_duplicate_decisions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "listing_duplicate_groups" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "listing_duplicate_decisions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "listing_duplicate_decisions_decision_check" CHECK ("decision" IN ('confirm', 'different', 'defer', 'split'))
);

-- CreateTable
CREATE TABLE "task_checklist_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "responsible_user_id" TEXT,
    "due_at" DATETIME,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'open',
    "result" TEXT,
    "completed_at" DATETIME,
    "completed_by" TEXT,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "task_checklist_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "task_checklist_items_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "task_checklist_items_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "task_checklist_items_status_check" CHECK ("status" IN ('open', 'done', 'cancelled'))
);

-- CreateTable
CREATE TABLE "planner_settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "soon_threshold_hours" INTEGER NOT NULL DEFAULT 24,
    "updated_by" TEXT,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "planner_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "planner_settings_threshold_check" CHECK ("soon_threshold_hours" > 0 AND "soon_threshold_hours" <= 8760)
);

-- CreateTable
CREATE TABLE "bulk_task_batches" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "idempotency_key" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "count" INTEGER NOT NULL,
    "template" JSONB NOT NULL,
    CONSTRAINT "bulk_task_batches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "bulk_task_batches_count_check" CHECK ("count" > 0)
);

-- CreateTable
CREATE TABLE "property_collections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "archived_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "property_collections_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "property_collections_visibility_check" CHECK ("visibility" IN ('private', 'team'))
);

-- CreateTable
CREATE TABLE "property_collection_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collection_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "external_listing_id" TEXT,
    "property_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'in_collection',
    "comment" TEXT,
    "exclusion_reason" TEXT,
    "added_by" TEXT NOT NULL,
    "added_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "property_collection_items_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "property_collections" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "property_collection_items_external_listing_id_fkey" FOREIGN KEY ("external_listing_id") REFERENCES "external_listings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "property_collection_items_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "property_collection_items_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "property_collection_items_status_check" CHECK ("status" IN ('in_collection', 'check', 'in_crm', 'proposed', 'excluded')),
    CONSTRAINT "property_collection_items_target_xor_check" CHECK (("external_listing_id" IS NOT NULL) <> ("property_id" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "property_collection_needs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collection_id" TEXT NOT NULL,
    "need_id" TEXT NOT NULL,
    "linked_by" TEXT NOT NULL,
    "linked_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    CONSTRAINT "property_collection_needs_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "property_collections" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "property_collection_needs_need_id_fkey" FOREIGN KEY ("need_id") REFERENCES "client_needs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "property_collection_needs_linked_by_fkey" FOREIGN KEY ("linked_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "document_templates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "allowed_sources" JSONB NOT NULL DEFAULT '[]',
    "current_version_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "document_templates_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "document_template_versions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "document_templates_format_check" CHECK ("format" IN ('markdown_docx', 'docx', 'xlsx', 'xlsx_registry')),
    CONSTRAINT "document_templates_status_check" CHECK ("status" IN ('active', 'disabled', 'archived')),
    CONSTRAINT "DocumentTemplate_allowedSources_array" CHECK (json_valid("allowed_sources") AND json_type("allowed_sources") = 'array'),
    CONSTRAINT "document_templates_current_version_owner_fkey" FOREIGN KEY ("current_version_id","id") REFERENCES "document_template_versions"("id","template_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- CreateTable
CREATE TABLE "document_template_versions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "template_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "manifest_yaml" TEXT NOT NULL,
    "storage_key" TEXT,
    "markdown_body" TEXT,
    "checksum" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "compatibility_note" TEXT,
    CONSTRAINT "document_template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "document_templates" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "document_template_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "document_template_versions_positive_check" CHECK ("version" > 0)
);

-- CreateTable
CREATE TABLE "ai_chat_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "context_type" TEXT NOT NULL DEFAULT 'none',
    "context_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "updated_at" DATETIME NOT NULL,
    "archived_at" DATETIME,
    CONSTRAINT "ai_chat_sessions_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ai_chat_sessions_context_type_check" CHECK ("context_type" IN ('client', 'need', 'collection', 'none')),
    CONSTRAINT "ai_chat_sessions_context_check" CHECK (("context_type" = 'none' AND "context_id" IS NULL) OR ("context_type" <> 'none' AND "context_id" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "ai_chat_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tool_name" TEXT,
    "tool_args" JSONB,
    "tool_result_summary" TEXT,
    "ai_usage_log_id" TEXT,
    "pending_action_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    CONSTRAINT "ai_chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_chat_sessions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ai_chat_messages_ai_usage_log_id_fkey" FOREIGN KEY ("ai_usage_log_id") REFERENCES "ai_usage_logs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ai_chat_messages_pending_action_id_fkey" FOREIGN KEY ("pending_action_id") REFERENCES "ai_pending_actions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ai_chat_messages_role_check" CHECK ("role" IN ('user', 'assistant', 'tool')),
    CONSTRAINT "ai_chat_messages_pending_action_session_fkey" FOREIGN KEY ("pending_action_id","session_id") REFERENCES "ai_pending_actions"("id","session_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- CreateTable
CREATE TABLE "ai_pending_actions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "decided_by" TEXT,
    "decided_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    "expires_at" DATETIME,
    CONSTRAINT "ai_pending_actions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_chat_sessions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ai_pending_actions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ai_pending_actions_status_check" CHECK ("status" IN ('proposed', 'confirmed', 'rejected', 'expired')),
    CONSTRAINT "ai_pending_actions_decision_check" CHECK (("status" IN ('confirmed', 'rejected') AND "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL) OR "status" IN ('proposed', 'expired'))
);

-- CreateTable
CREATE TABLE "ai_analysis_caches" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cache_key" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "ai_usage_log_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    CONSTRAINT "ai_analysis_caches_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "external_listings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ai_analysis_caches_ai_usage_log_id_fkey" FOREIGN KEY ("ai_usage_log_id") REFERENCES "ai_usage_logs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "search_exports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "columns" JSONB NOT NULL DEFAULT '[]',
    "row_count" INTEGER NOT NULL,
    "document_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    CONSTRAINT "search_exports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "search_exports_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "search_exports_format_check" CHECK ("format" IN ('xlsx', 'csv')),
    CONSTRAINT "search_exports_scope_check" CHECK ("scope" IN ('all_filtered', 'selected')),
    CONSTRAINT "search_exports_row_count_check" CHECK ("row_count" >= 0),
    CONSTRAINT "SearchExport_columns_array" CHECK (json_valid("columns") AND json_type("columns") = 'array')
);

-- CreateTable
CREATE TABLE "document_collections" (
    "document_id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,

    PRIMARY KEY ("document_id", "collection_id"),
    CONSTRAINT "document_collections_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "document_collections_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "property_collections" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
CREATE INDEX "lead_requests_external_listing_id_idx" ON "lead_requests"("external_listing_id");

-- CreateIndex
CREATE INDEX "lead_requests_call_at_responsible_user_id_idx" ON "lead_requests"("call_at", "responsible_user_id");

-- CreateIndex
CREATE INDEX "lead_requests_outcome_code_occurred_at_idx" ON "lead_requests"("outcome_code", "occurred_at");

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
CREATE INDEX "tasks_bulk_batch_id_idx" ON "tasks"("bulk_batch_id");

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
CREATE INDEX "legal_entities_logo_document_id_idx" ON "legal_entities"("logo_document_id");

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
CREATE INDEX "documents_template_version_id_idx" ON "documents"("template_version_id");

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
CREATE INDEX "backup_target_runs_backup_remote_id_verify_status_finished_at_idx" ON "backup_target_runs"("backup_remote_id", "verify_status", "finished_at");

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
CREATE INDEX "external_listings_property_id_idx" ON "external_listings"("property_id");

-- CreateIndex
CREATE INDEX "external_listings_city_operation_last_seen_at_idx" ON "external_listings"("city", "operation", "last_seen_at");

-- CreateIndex
CREATE INDEX "external_listing_snapshots_published_at_id_idx" ON "external_listing_snapshots"("published_at", "id");

-- CreateIndex
CREATE INDEX "external_listing_snapshots_source_updated_at_id_idx" ON "external_listing_snapshots"("source_updated_at", "id");

-- CreateIndex
CREATE INDEX "external_listing_snapshots_first_seen_at_id_idx" ON "external_listing_snapshots"("first_seen_at", "id");

-- CreateIndex
CREATE INDEX "external_listing_snapshots_price_rub_id_idx" ON "external_listing_snapshots"("price_rub", "id");

-- CreateIndex
CREATE INDEX "external_listing_snapshots_price_per_m2_unit_price_per_m2_rub_id_idx" ON "external_listing_snapshots"("price_per_m2_unit", "price_per_m2_rub", "id");

-- CreateIndex
CREATE INDEX "external_listing_snapshots_area_m2_id_idx" ON "external_listing_snapshots"("area_m2", "id");

-- CreateIndex
CREATE INDEX "external_listing_snapshots_last_checked_at_id_idx" ON "external_listing_snapshots"("last_checked_at", "id");

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
CREATE UNIQUE INDEX "search_runs_idempotency_key_key" ON "search_runs"("idempotency_key");

-- CreateIndex
CREATE INDEX "search_runs_status_heartbeat_at_started_at_idx" ON "search_runs"("status", "heartbeat_at", "started_at");

-- CreateIndex
CREATE INDEX "search_runs_deadline_at_idx" ON "search_runs"("deadline_at");

-- CreateIndex
CREATE INDEX "search_runs_saved_search_id_started_at_idx" ON "search_runs"("saved_search_id", "started_at");

-- CreateIndex
CREATE INDEX "search_runs_need_id_idx" ON "search_runs"("need_id");

-- CreateIndex
CREATE INDEX "search_runs_user_id_started_at_idx" ON "search_runs"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "search_run_sources_status_retry_after_at_idx" ON "search_run_sources"("status", "retry_after_at");

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
CREATE INDEX "interactive_browser_sessions_search_run_id_source_idx" ON "interactive_browser_sessions"("search_run_id", "source");

-- CreateIndex
CREATE INDEX "interactive_browser_sessions_owner_user_id_status_expires_at_idx" ON "interactive_browser_sessions"("owner_user_id", "status", "expires_at");

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
CREATE INDEX "document_collections_collection_id_idx" ON "document_collections"("collection_id");


-- Manual equivalents not expressible by Prisma DSL. No PG migrations are modified.
CREATE UNIQUE INDEX client_contacts_client_type_normalized_key ON client_contacts(client_id,contact_type,normalized_value) WHERE normalized_value IS NOT NULL;
CREATE UNIQUE INDEX property_contact_grants_active_key ON property_contact_grants(property_id,user_id) WHERE revoked_at IS NULL;
-- NULLS NOT DISTINCT: split null unit and populated unit cases, preserving null vs empty.
CREATE UNIQUE INDEX external_listings_source_identity_null_key ON external_listings(source,source_listing_id) WHERE source_listing_id IS NOT NULL AND source_unit_id IS NULL;
CREATE UNIQUE INDEX external_listings_source_identity_unit_key ON external_listings(source,source_listing_id,source_unit_id) WHERE source_listing_id IS NOT NULL AND source_unit_id IS NOT NULL;
CREATE UNIQUE INDEX ai_settings_singleton_key ON ai_settings((1));
CREATE UNIQUE INDEX planner_settings_singleton_key ON planner_settings((1));
CREATE UNIQUE INDEX document_properties_active_cover_key ON document_properties(property_id) WHERE is_cover AND kind='photo' AND archived_at IS NULL;
CREATE UNIQUE INDEX listing_duplicate_members_active_listing_key ON listing_duplicate_members(listing_id) WHERE released_at IS NULL;
CREATE UNIQUE INDEX document_template_versions_id_template_key ON document_template_versions(id,template_id);
CREATE UNIQUE INDEX ai_pending_actions_id_session_key ON ai_pending_actions(id,session_id);
CREATE TRIGGER tasks_reminders_insert BEFORE INSERT ON tasks WHEN EXISTS(SELECT 1 FROM json_each(NEW.reminder_offsets) WHERE type <> 'integer' OR value < 0)
BEGIN SELECT RAISE(ABORT,'tasks_reminder_offsets_check'); END;
CREATE TRIGGER tasks_reminders_update BEFORE UPDATE OF reminder_offsets ON tasks WHEN EXISTS(SELECT 1 FROM json_each(NEW.reminder_offsets) WHERE type <> 'integer' OR value < 0)
BEGIN SELECT RAISE(ABORT,'tasks_reminder_offsets_check'); END;
CREATE TRIGGER document_properties_active_cover_insert BEFORE INSERT ON document_properties WHEN NEW.is_cover AND EXISTS(SELECT 1 FROM documents WHERE id=NEW.document_id AND archived_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'Archived document cannot be a property cover'); END;
CREATE TRIGGER document_properties_active_cover_update BEFORE UPDATE ON document_properties WHEN NEW.is_cover AND EXISTS(SELECT 1 FROM documents WHERE id=NEW.document_id AND archived_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'Archived document cannot be a property cover'); END;
CREATE TRIGGER documents_clear_archived_cover AFTER UPDATE OF archived_at ON documents WHEN NEW.archived_at IS NOT NULL AND OLD.archived_at IS NOT NEW.archived_at
BEGIN UPDATE document_properties SET is_cover=false WHERE document_id=NEW.id AND is_cover; END;
CREATE TRIGGER v31_duplicate_member_insert AFTER INSERT ON listing_duplicate_members WHEN NEW.released_at IS NULL AND EXISTS(SELECT 1 FROM listing_duplicate_groups WHERE id=NEW.group_id AND status='rejected')
BEGIN UPDATE listing_duplicate_members SET released_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE id=NEW.id; END;
CREATE TRIGGER v31_duplicate_member_update AFTER UPDATE ON listing_duplicate_members WHEN NEW.released_at IS NULL AND EXISTS(SELECT 1 FROM listing_duplicate_groups WHERE id=NEW.group_id AND status='rejected')
BEGIN UPDATE listing_duplicate_members SET released_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE id=NEW.id; END;
CREATE TRIGGER v31_duplicate_group_release AFTER UPDATE OF status ON listing_duplicate_groups WHEN NEW.status='rejected'
BEGIN UPDATE listing_duplicate_members SET released_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE group_id=NEW.id AND released_at IS NULL; END;

