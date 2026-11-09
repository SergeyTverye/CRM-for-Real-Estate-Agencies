
INSERT INTO audit_log (action, entity_type, entity_id, after_jsonb)
VALUES (:'action', 'Instance', :'dep'::uuid, jsonb_build_object('instanceId', :'inst', 'confirmedBy', :'who', 'at', now()));
