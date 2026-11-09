import { z } from "zod";
import { db, transaction } from "@/shared/db/client";
import { ConflictError, DomainError, ForbiddenError, NotFoundError, ValidationError } from "@/shared/errors";
import { parseInput, zCode, zRequiredText } from "@/shared/validation";
import { writeAudit } from "@/modules/audit/application/audit";
import { hashPassword, generateTemporaryPassword } from "@/modules/auth/infrastructure/password-hasher";
import { LOGIN_RE, normalizeLogin, passwordPolicyErrors } from "@/modules/auth/domain/password-policy";
import { revokeAllUserSessions } from "@/modules/auth/application/session-service";
import { isManager, type Actor } from "@/modules/auth/domain/actor";



export interface UserDto {
  id: string;
  login: string;
  displayName: string;
  roleCode: string;
  isActive: boolean;
  mustChangePassword: boolean;
  passwordChangedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSelect = {
  id: true,
  login: true,
  displayName: true,
  roleCode: true,
  isActive: true,
  mustChangePassword: true,
  passwordChangedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

function requireManager(actor: Actor) {
  if (!isManager(actor)) throw new ForbiddenError();
}

export async function listUsers(actor: Actor): Promise<UserDto[]> {
  requireManager(actor);
  return db.user.findMany({ select: userSelect, orderBy: [{ isActive: "desc" }, { displayName: "asc" }] });
}


export async function listActiveUsersBrief(): Promise<{ id: string; displayName: string; roleCode: string }[]> {
  return db.user.findMany({
    where: { isActive: true },
    select: { id: true, displayName: true, roleCode: true },
    orderBy: { displayName: "asc" },
  });
}

const createSchema = z.object({
  login: z
    .string()
    .transform(normalizeLogin)
    .pipe(z.string().regex(LOGIN_RE, "Логин: 3–50 символов, латиница, цифры, . _ -")),
  displayName: zRequiredText(200),
  roleCode: zCode("userRole"),
});

export async function createUser(actor: Actor, input: unknown): Promise<{ user: UserDto; temporaryPassword: string }> {
  requireManager(actor);
  const data = parseInput(createSchema, input);
  const exists = await db.user.findUnique({ where: { login: data.login } });
  if (exists) throw new ValidationError("Логин уже используется", { login: ["Логин уже используется"] });
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const user = await transaction(async (tx) => {
    const created = await tx.user.create({
      data: { ...data, passwordHash, mustChangePassword: true },
      select: userSelect,
    });
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: "user.created",
      entityType: "User",
      entityId: created.id,
      after: { login: created.login, displayName: created.displayName, roleCode: created.roleCode },
    });
    return created;
  });
  return { user, temporaryPassword };
}

const updateSchema = z.object({
  displayName: zRequiredText(200).optional(),
  roleCode: zCode("userRole").optional(),
  isActive: z.boolean().optional(),
});

async function activeManagersCount(): Promise<number> {
  return db.user.count({ where: { roleCode: "manager", isActive: true } });
}


export async function updateUser(actor: Actor, userId: string, input: unknown): Promise<UserDto> {
  requireManager(actor);
  const data = parseInput(updateSchema, input);
  const before = await db.user.findUnique({ where: { id: userId }, select: userSelect });
  if (!before) throw new NotFoundError();
  const demotesManager = before.roleCode === "manager" && before.isActive && (data.roleCode === "realtor" || data.isActive === false);
  if (demotesManager && (await activeManagersCount()) <= 1) {
    throw new DomainError("LAST_MANAGER", "Нельзя деактивировать или понизить последнего активного руководителя");
  }
  return transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id: userId }, data, select: userSelect });
    if (data.roleCode && data.roleCode !== before.roleCode) {
      await writeAudit(tx, { actorUserId: actor.userId, action: "user.role_changed", entityType: "User", entityId: userId, before: { roleCode: before.roleCode }, after: { roleCode: data.roleCode } });
    }
    if (data.isActive !== undefined && data.isActive !== before.isActive) {
      const revoked = data.isActive ? 0 : await revokeAllUserSessions(tx, userId);
      await writeAudit(tx, {
      actorUserId: actor.userId,
        action: data.isActive ? "user.activated" : "user.deactivated",
        entityType: "User",
        entityId: userId,
        before: { isActive: before.isActive },
        after: { isActive: data.isActive, revokedSessions: revoked },
      });
    }
    if (data.displayName && data.displayName !== before.displayName) {
      await writeAudit(tx, { actorUserId: actor.userId, action: "user.renamed", entityType: "User", entityId: userId, before: { displayName: before.displayName }, after: { displayName: data.displayName } });
    }
    return updated;
  });
}


export async function resetUserPassword(actor: Actor, userId: string): Promise<{ temporaryPassword: string }> {
  requireManager(actor);
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError();
  if (!user.isActive) throw new ConflictError("USER_INACTIVE", "Сначала восстановите учётную запись");
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  await transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: true, passwordChangedAt: new Date() } });
    const revoked = await revokeAllUserSessions(tx, userId);
    await writeAudit(tx, { actorUserId: actor.userId, action: "user.password_reset", entityType: "User", entityId: userId, after: { mustChangePassword: true, revokedSessions: revoked } });
  });
  return { temporaryPassword };
}


export function assertPasswordPolicy(password: string, login: string): void {
  const errors = passwordPolicyErrors(password, login);
  if (errors.length) throw new ValidationError("Пароль не соответствует требованиям", { password: errors });
}
