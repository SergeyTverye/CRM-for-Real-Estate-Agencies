import { Prisma } from "@/generated/prisma/client";
export interface DecimalSpec { precision: number; scale: number }
/** Exact base-10 conversion. Number fractions and excess precision are rejected. */
export function toSqliteUnits(value: unknown, spec: DecimalSpec): bigint {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("SQLITE_DECIMAL_NUMBER_UNSAFE");
  const decimal = new Prisma.Decimal(String(value));
  if (!decimal.isFinite()) throw new Error("SQLITE_DECIMAL_NOT_FINITE");
  const scaled = decimal.mul(new Prisma.Decimal(10).pow(spec.scale));
  if (!scaled.isInteger()) throw new Error("SQLITE_DECIMAL_SCALE");
  if (scaled.abs().gte(new Prisma.Decimal(10).pow(spec.precision))) throw new Error("SQLITE_DECIMAL_RANGE");
  return BigInt(scaled.toFixed(0));
}
export function fromSqliteUnits(value: bigint, spec: DecimalSpec): Prisma.Decimal {
  return new Prisma.Decimal(value.toString()).div(new Prisma.Decimal(10).pow(spec.scale));
}

