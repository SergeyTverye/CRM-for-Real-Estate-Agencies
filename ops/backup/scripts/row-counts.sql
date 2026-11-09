




SELECT 'SELECT json_object_agg(name, total) FROM (' || string_agg(
  format('SELECT %L AS name, count(*) AS total FROM %I.%I', tablename, schemaname, tablename), ' UNION ALL ' ORDER BY tablename
) || ') counts' FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
\gexec
