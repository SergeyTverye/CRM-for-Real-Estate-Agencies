import { z } from "zod";
import { db, transaction } from "@/shared/db/client";
import { NotFoundError, ConflictError, ValidationError } from "@/shared/errors";
import { hashPassword } from "@/modules/auth/infrastructure/password-hasher";
import { LOGIN_RE, passwordPolicyErrors } from "@/modules/auth/domain/password-policy";
import { DICTIONARY_SEED } from "@/modules/dictionaries/domain/dictionary-data";
import { writeAudit } from "@/modules/audit/application/audit";
import { parseInput } from "@/shared/validation";
function assertDesktop() {
  if (process.env.CRM_DEPLOYMENT_MODE !== "desktop") throw new NotFoundError();
}
export async function desktopSetupStatus() {
  assertDesktop();
  return { available: await db.user.count() === 0, dataDirectory: process.env.DESKTOP_DATA_DIR ?? "" };
}
const schema = z.object({
  login: z.string().trim().toLowerCase().regex(LOGIN_RE), displayName: z.string().trim().min(1).max(120),
  password: z.string().min(10).max(200), mode: z.enum(["empty", "demo"]),
  dataDirectory: z.literal("default"), localDiskConfirmed: z.literal(true),
}).strict();
export async function completeDesktopSetup(input: unknown) {
  assertDesktop();
  const body = parseInput(schema, input);
  if (await db.user.count()) throw new ConflictError("SETUP_COMPLETE", "Первоначальная настройка уже выполнена");
  const errors = passwordPolicyErrors(body.password, body.login);
  if (errors.length) throw new ValidationError("Пароль не соответствует требованиям", { password: errors });
  const passwordHash = await hashPassword(body.password);
  return transaction(async tx => {
    if (await tx.user.count()) throw new ConflictError("SETUP_COMPLETE", "Первоначальная настройка уже выполнена");
    const manager = await tx.user.create({ data: { login: body.login, displayName: body.displayName, roleCode: "manager", passwordHash, mustChangePassword: false, passwordChangedAt: new Date() } });
    for (const [category, items] of Object.entries(DICTIONARY_SEED)) {
      let sortOrder = 10;
      for (const [code, displayName] of items) {
        await tx.dictionaryItem.upsert({ where: { category_code: { category, code } }, update: {}, create: { category, code, displayName, sortOrder } });
        sortOrder += 10;
      }
    }
    if (!await tx.legalEntity.count()) await tx.legalEntity.createMany({ data: [
      { entityType: "LLC", displayName: "ООО (уточните наименование)" }, { entityType: "IP", displayName: "ИП (уточните наименование)" },
    ] });
    if (body.mode === "demo") for (let i = 1; i <= 3; i++) {
      const client = await tx.client.create({ data: { displayName: "ДЕМО: клиент " + i, clientKind: "person", status: "active", responsibleUserId: manager.id, createdBy: manager.id } });
      const need = await tx.clientNeed.create({ data: { clientId: client.id, responsibleUserId: manager.id, createdBy: manager.id, operationType: "rent", propertyType: "commercial", status: "active", stage: "selection", budgetMax: "150000.00", areaMin: "50", areaMax: "150" } });
      await tx.task.create({ data: { title: "ДЕМО: уточнить подбор", taskType: "call_or_contact", status: "planned", priority: "normal", dueAt: new Date(Date.now() + i * 86400000), responsibleUserId: manager.id, createdBy: manager.id, needLinks: { create: { clientNeedId: need.id } }, clientLinks: { create: { clientId: client.id } } } });
      await tx.property.create({ data: { addressText: "ДЕМО: деловой квартал, дом " + i, propertyType: "commercial", operationType: "rent", sourceType: "agency_listing", status: "active", area: String(50 + i * 10), price: String(50000 + i * 5000), responsibleUserId: manager.id, createdBy: manager.id } });
    }
    await writeAudit(tx, { actorUserId: manager.id, action: "desktop.setup_completed", entityType: "User", entityId: manager.id, after: { initialData: body.mode } });
    return { ok: true };
  });
}
