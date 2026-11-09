import { normalizeEmail, normalizePhone } from "@/modules/clients/domain/contact-normalization";



export type Cell = string | number | boolean | Date | null;

export function cellText(v: Cell | undefined): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/ /g, " ").trim();
}


export function parseNumber(v: Cell | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  let s = cellText(v).toLowerCase();
  let mult = 1;
  if (/млн/.test(s)) mult = 1_000_000;
  else if (/тыс/.test(s)) mult = 1_000;
  s = s.replace(/(м²|м2|кв\.?\s*м|руб\.?|р\.|₽|млн\.?|тыс\.?)/g, "").replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s) * mult;
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : null;
}

export function parseInteger(v: Cell | undefined): number | null {
  const n = parseNumber(v);
  return n !== null && Number.isInteger(Number(n)) ? Number(n) : null;
}


export function parseDate(v: Cell | undefined): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const ms = Math.round((v - 25569) * 86_400_000);
    const d = new Date(ms);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const s = cellText(v);
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return validDate(y, Number(m[2]), Number(m[1]));
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

const MONTHS: Record<string, number> = {
  янв: 1, фев: 2, мар: 3, апр: 4, мая: 5, май: 5, июн: 6, июл: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12,
};

export function dateFromParts(year: Cell | undefined, month: Cell | undefined, day: Cell | undefined): Date | null {
  const y = parseInteger(year);
  if (!y || y < 1990 || y > 2100) return null;
  let mo = parseInteger(month);
  if (!mo && month) {
    const key = cellText(month).toLowerCase().slice(0, 3);
    mo = MONTHS[key] ?? null;
  }
  const d = parseInteger(day) ?? 1;
  return validDate(y, mo ?? 1, d);
}

function validDate(y: number, m: number, d: number): Date | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1950 || y > 2100) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 ? date : null;
}

export function normalizeAddress(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\b(г|город|ул|улица|пр|проспект|пер|переулок|д|дом|кв|оф|офис|стр|корп)\.?\s*/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function contactKind(raw: string): { type: "phone" | "email" | "other"; normalized: string | null } {
  const email = normalizeEmail(raw);
  if (email) return { type: "email", normalized: email };
  const phone = normalizePhone(raw);
  if (phone && phone.replace(/\D/g, "").length >= 10) return { type: "phone", normalized: phone };
  return { type: "other", normalized: null };
}
