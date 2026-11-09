import "server-only";
import { getConfig } from "@/shared/config/env";
import { formatDate, formatDateTime } from "@/shared/time";


export const tz = () => getConfig().APP_TIMEZONE;
export const fmtDateTime = (d: Date | string | null | undefined) => formatDateTime(d, tz());
export const fmtDate = (d: Date | string | null | undefined) => formatDate(d, tz());

export const fmtDateOnly = (d: Date | null | undefined) => (d ? formatDate(d.toISOString().slice(0, 10), tz()) : "—");

export function fmtMoney(v: { toString(): string } | number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v.toString());
  if (!Number.isFinite(n)) return String(v);
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2, minimumFractionDigits: n % 1 ? 2 : 0 }).format(n)} ₽`;
}

export function fmtNum(v: { toString(): string } | number | null | undefined, unit = ""): string {
  if (v === null || v === undefined) return "—";
  const n = Number(v.toString());
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(n)}${unit ? ` ${unit}` : ""}`;
}
