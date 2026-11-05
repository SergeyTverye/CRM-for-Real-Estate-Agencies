-- Run in the same exported snapshot as pg_dump. Table names come only from pg_catalog.
-- Includes ALL v3.1 tables automatically: interactive_browser_sessions metadata (never
-- profiles/cookies), listing_duplicate_*, task_checklist_items, planner_settings,
-- bulk_task_batches, property_collection_*, document_templates/versions/collections,
-- ai_chat_sessions/messages/pending_actions/analysis_caches and search_exports.
SELECT 'SELECT json_object_agg(name, total) FROM (' || string_agg(
  format('SELECT %L AS name, count(*) AS total FROM %I.%I', tablename, schemaname, tablename), ' UNION ALL ' ORDER BY tablename
) || ') counts' FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
\gexec
