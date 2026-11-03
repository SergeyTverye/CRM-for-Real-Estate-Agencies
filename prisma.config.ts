// Prisma 7 CLI config. Prisma 7 не загружает .env сам — используем dotenv.
// Для `prisma generate` (Docker build) реальное подключение не нужно,
// поэтому при отсутствии DATABASE_URL подставляется заведомо недоступный адрес.
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Локальная разработка — .env.local (как у Next.js), развёртывание — .env / переменные контейнера.
loadEnv({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"] ?? "postgresql://unset:unset@127.0.0.1:1/unset",
  },
});
