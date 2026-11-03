-- Событие эксплуатации экземпляра (promote/demote) в AuditLog. Параметры передаются через psql -v.
INSERT INTO audit_log (action, entity_type, entity_id, after_jsonb)
VALUES (:'action', 'Instance', :'dep'::uuid, jsonb_build_object('instanceId', :'inst', 'confirmedBy', :'who', 'at', now()));
