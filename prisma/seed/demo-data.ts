import type { PrismaClient } from "../../src/generated/prisma/client";

/**
 * Демонстрационные синтетические данные (SEED_DEMO_DATA=true).
 * Наполняется по мере реализации доменных модулей (I2–I4).
 */
export async function seedDemoData(_db: PrismaClient): Promise<string> {
  return "нет демо-данных для текущего инкремента";
}
