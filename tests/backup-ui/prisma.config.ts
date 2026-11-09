import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "../../prisma/schema.prisma",
  migrations: { path: "../../prisma/migrations" },
  datasource: { url: "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_test_f" },
});
