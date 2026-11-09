import { defineConfig } from "prisma/config";
import { resolve } from "node:path";
export default defineConfig({
  schema: "sqlite/schema.prisma",
  migrations: { path: "sqlite/migrations" },
  datasource: { url: process.env.SQLITE_DATABASE_URL ?? "file:" + resolve("data/desktop/crm.db").replaceAll("\\","/") },
});

