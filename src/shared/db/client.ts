import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { getConfig } from "../config/env";

/**
 * Единственный экземпляр PrismaClient на процесс (пул соединений через driver adapter pg).
 * Data access layer: доступ к БД есть только у application/infrastructure кода модулей.
 */
function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: getConfig().DATABASE_URL, max: 10 });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { __crmPrisma?: PrismaClient };

export function getDb(): PrismaClient {
  if (!globalForPrisma.__crmPrisma) globalForPrisma.__crmPrisma = createClient();
  return globalForPrisma.__crmPrisma;
}

/** Ленивый прокси, чтобы импорт модуля не открывал соединение (важно для next build). */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getDb() as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(client, prop);
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});

export type Tx = Prisma.TransactionClient;
export type DbOrTx = PrismaClient | Tx;

/** Интерактивная транзакция с разумными таймаутами. */
export function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().$transaction(fn, { timeout: 30_000, maxWait: 10_000 });
}

export async function disconnectDb(): Promise<void> {
  if (globalForPrisma.__crmPrisma) {
    await globalForPrisma.__crmPrisma.$disconnect();
    globalForPrisma.__crmPrisma = undefined;
  }
}

export { Prisma };
