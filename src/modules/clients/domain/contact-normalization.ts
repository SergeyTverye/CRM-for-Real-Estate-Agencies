/**
 * Нормализация контактов для поиска вероятных дублей (ТЗ 19.2, 38.8, 40.2).
 * Телефон → E.164-подобная строка (+7XXXXXXXXXX для российских номеров), e-mail → lowercase.
 * Совпадение нормализованного значения — сильный признак дубля, но не основание для auto-merge.
 */

export type ContactType = "phone" | "email" | "other";

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 15) return null;
  if (digits.length === 11 && (digits.startsWith("8") || digits.startsWith("7"))) return `+7${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("9")) return `+7${digits}`;
  if (raw.trim().startsWith("+")) return `+${digits}`;
  return digits.length >= 10 ? `+${digits}` : digits;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  return EMAIL_RE.test(v) ? v : null;
}

export function normalizeContact(type: ContactType, raw: string): string | null {
  if (type === "phone") return normalizePhone(raw);
  if (type === "email") return normalizeEmail(raw);
  return null;
}

/** Определение типа по введённому значению (быстрая форма обращения). */
export function guessContactType(raw: string): ContactType {
  if (normalizeEmail(raw)) return "email";
  if (normalizePhone(raw)) return "phone";
  return "other";
}

/** Маска телефона для отображения без полного раскрытия (журналы, нейтральные сообщения). */
export function maskPhone(normalized: string): string {
  return normalized.length > 6 ? `${normalized.slice(0, 4)}***${normalized.slice(-2)}` : "***";
}
