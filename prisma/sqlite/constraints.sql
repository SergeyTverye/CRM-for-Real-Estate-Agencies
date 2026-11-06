
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

