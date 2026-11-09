import type { DbOrTx } from "@/shared/db/client";
import { getRequestContext } from "@/shared/context";
import { Prisma } from "@/generated/prisma/client";



const SECRET_KEY_RE = /(password|token|secret|storagekey|storage_key|cookie|crypt)/i;

function sanitize(value: unknown, depth = 0): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;
  if (depth > 6) return "[depth]";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toString();
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1)) as Prisma.InputJsonValue;
  if (typeof value === "object") {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k)) continue;
      out[k] = sanitize(v, depth + 1);
    }
    return out as Prisma.InputJsonValue;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  actorUserId?: string | null;
}

export async function writeAudit(tx: DbOrTx, entry: AuditEntry): Promise<void> {
  const ctx = getRequestContext();
  const before = sanitize(entry.before);
  const after = sanitize(entry.after);
  await tx.auditLog.create({
    data: {
      actorUserId: entry.actorUserId ?? ctx?.actorUserId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      beforeJsonb: before === null ? Prisma.DbNull : before,
      afterJsonb: after === null ? Prisma.DbNull : after,
      correlationId: ctx?.correlationId ?? null,
    },
  });
}


export function diffFields<T extends Record<string, unknown>>(before: T, after: Partial<T>): { before: Partial<T>; after: Partial<T> } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    const bv = before[key];
    const av = after[key];
    const same =
      bv instanceof Date && av instanceof Date
        ? bv.getTime() === av.getTime()
        : Prisma.Decimal.isDecimal(bv) && av !== null && av !== undefined
          ? (bv as Prisma.Decimal).equals(new Prisma.Decimal(String(av)))
          : bv === av;
    if (!same) {
      b[key] = bv;
      a[key] = av as T[keyof T];
    }
  }
  return { before: b, after: a };
}
