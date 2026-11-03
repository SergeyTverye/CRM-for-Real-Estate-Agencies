/**
 * Seed синтетических данных (ТЗ 21, 35.2). Не содержит реальных персональных данных.
 *
 * Системная часть (всегда, идемпотентно):
 *   - бизнес-справочники dictionary_items;
 *   - юридические субъекты ИП/ООО (наименования-заглушки, уточняются руководителем);
 *   - три учётные записи: руководитель и два риелтора. Пароли берутся из
 *     SEED_*_PASSWORD (их генерирует scripts/bootstrap.sh) и требуют смены при первом входе.
 *     Существующие пользователи не изменяются.
 * Демо-данные (только при SEED_DEMO_DATA=true): синтетические клиенты, объекты,
 *   потребности и задачи для демонстрации сценариев.
 */
import { config as loadEnv } from "dotenv";
import { randomBytes } from "node:crypto";
import { getDb, disconnectDb } from "../src/shared/db/client";
import { hashPassword } from "../src/modules/auth/infrastructure/password-hasher";
import { passwordPolicyErrors } from "../src/modules/auth/domain/password-policy";
import { DICTIONARY_SEED } from "../src/modules/dictionaries/domain/dictionary-data";
import { seedDemoData } from "./seed/demo-data";

loadEnv({ path: [".env.local", ".env"], quiet: true });
const db = getDb();

async function seedDictionaries() {
  let created = 0;
  for (const [category, items] of Object.entries(DICTIONARY_SEED)) {
    let order = 10;
    for (const [code, displayName] of items) {
      const res = await db.dictionaryItem.upsert({
        where: { category_code: { category, code } },
        update: {},
        create: { category, code, displayName, sortOrder: order },
      });
      if (res.createdAt.getTime() > Date.now() - 60_000) created++;
      order += 10;
    }
  }
  return created;
}

async function seedLegalEntities() {
  const count = await db.legalEntity.count();
  if (count > 0) return 0;
  await db.legalEntity.createMany({
    data: [
      { entityType: "LLC", displayName: "ООО «Магазин недвижимости»" },
      { entityType: "IP", displayName: "ИП (наименование уточняется руководителем)" },
    ],
  });
  return 2;
}

interface SeedUser {
  login: string;
  displayName: string;
  roleCode: "manager" | "realtor";
  passwordEnv: string;
}

const USERS: SeedUser[] = [
  { login: process.env.SEED_MANAGER_LOGIN ?? "manager", displayName: "Руководитель", roleCode: "manager", passwordEnv: "SEED_MANAGER_PASSWORD" },
  { login: process.env.SEED_REALTOR1_LOGIN ?? "realtor1", displayName: "Риелтор 1", roleCode: "realtor", passwordEnv: "SEED_REALTOR1_PASSWORD" },
  { login: process.env.SEED_REALTOR2_LOGIN ?? "realtor2", displayName: "Риелтор 2", roleCode: "realtor", passwordEnv: "SEED_REALTOR2_PASSWORD" },
];

async function seedUsers() {
  const generated: string[] = [];
  for (const u of USERS) {
    const exists = await db.user.findUnique({ where: { login: u.login } });
    if (exists) continue;
    let password = process.env[u.passwordEnv];
    if (!password) {
      password = randomBytes(9).toString("base64url") + "7a";
      generated.push(`${u.login}: ${password}`);
    }
    const errors = passwordPolicyErrors(password, u.login);
    if (errors.length) throw new Error(`${u.passwordEnv}: ${errors.join(", ")}`);
    await db.user.create({
      data: {
        login: u.login,
        displayName: u.displayName,
        roleCode: u.roleCode,
        passwordHash: await hashPassword(password),
        mustChangePassword: process.env.SEED_MUST_CHANGE_PASSWORD !== "false",
      },
    });
    console.log(`seed: создан пользователь ${u.login} (${u.roleCode})`);
  }
  if (generated.length) {
    console.log("seed: пароли не заданы в окружении и сгенерированы (смените при первом входе):");
    for (const line of generated) console.log(`  ${line}`);
  }
}

async function main() {
  const dict = await seedDictionaries();
  const le = await seedLegalEntities();
  await seedUsers();
  console.log(`seed: справочники +${dict}, юрлица +${le}`);
  if (process.env.SEED_DEMO_DATA === "true") {
    const demo = await seedDemoData(db);
    console.log(`seed: демо-данные — ${demo}`);
  }
}

main()
  .then(() => disconnectDb())
  .catch(async (e) => {
    console.error("seed failed:", e instanceof Error ? e.message : e);
    await disconnectDb();
    process.exit(1);
  });
