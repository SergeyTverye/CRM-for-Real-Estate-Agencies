import { z } from "zod";
import { CODEBOOK, type CodebookName, codesOf } from "./codebook";
import { NotFoundError, ValidationError, type FieldErrors } from "./errors";

/**
 * Общие схемы runtime-валидации DTO (Zod). Серверная схема — доверенная граница.
 * клиентская валидация в формах — только для удобства (ТЗ 37.17).
 */

export const zUuid = z.string().uuid("Некорректный идентификатор");

/** Строка: обрезка пробелов, пустая строка → null. */
export const zText = (max = 4000) =>
  z
    .string()
    .max(max, `Не более ${max} символов`)
    .transform((s) => s.trim())
    .transform((s) => (s.length === 0 ? null : s));

export const zOptText = (max = 4000) => zText(max).nullish().transform((v) => v ?? null);

export const zRequiredText = (max = 500, message = "Обязательное поле") =>
  z
    .string({ error: message })
    .transform((s) => s.trim())
    .pipe(z.string().min(1, message).max(max, `Не более ${max} символов`));

/** Момент времени (ISO-8601 с часовым поясом) → Date. */
export const zDateTime = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)) && /T/.test(s), "Некорректные дата и время")
  .transform((s) => new Date(s));

export const zOptDateTime = z
  .union([zDateTime, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v instanceof Date ? v : null));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Календарная дата без времени 'YYYY-MM-DD' → Date (UTC-полночь, как хранит PostgreSQL date). */
export const zDateOnly = z
  .string()
  .regex(DATE_RE, "Дата в формате ГГГГ-ММ-ДД")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Некорректная дата")
  .transform((s) => new Date(`${s}T00:00:00.000Z`));

export const zOptDateOnly = z
  .union([zDateOnly, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v instanceof Date ? v : null));

/**
 * Денежная сумма numeric(16,2). Принимает строку/число, возвращает строку
 * без потери точности (float для денег запрещён — ТЗ 29.1).
 */
export const zMoney = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).replace(/\s/g, "").replace(",", "."))
  .refine((s) => /^\d{1,14}(\.\d{1,2})?$/.test(s), "Сумма: неотрицательное число, не более 2 знаков после запятой");

export const zOptMoney = z
  .union([zMoney, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v === "" || v === null || v === undefined ? null : v));

/** Неотрицательная десятичная величина (площадь, мощность). */
export const zOptDecimal = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => (v === null || v === undefined ? null : String(v).replace(/\s/g, "").replace(",", ".")))
  .refine((s) => s === null || s === "" || /^\d{1,10}(\.\d{1,4})?$/.test(s), "Неотрицательное число")
  .transform((s) => (s === "" ? null : s));

export const zOptInt = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => (v === null || v === undefined || v === "" ? null : Number(v)))
  .refine((n) => n === null || (Number.isInteger(n) && n >= -10 && n <= 1000), "Целое число");

export const zOptBool = z
  .union([z.boolean(), z.literal("true"), z.literal("false"), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v === true || v === "true" ? true : v === false || v === "false" ? false : null));

/** Код системного codebook. */
export function zCode<N extends CodebookName>(name: N, message = "Недопустимое значение") {
  const codes = codesOf(name) as [string, ...string[]];
  return z.enum(codes, { error: message }) as unknown as z.ZodType<keyof (typeof CODEBOOK)[N] & string>;
}

export function zOptCode<N extends CodebookName>(name: N) {
  return z
    .union([zCode(name), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v ? (v as keyof (typeof CODEBOOK)[N] & string) : null));
}

/** Ожидаемое значение updated_at для optimistic concurrency (ТЗ 40.10). */
export const zExpectedUpdatedAt = z
  .string({ error: "Не передана версия записи (updatedAt)" })
  .refine((s) => !Number.isNaN(Date.parse(s)), "Некорректная версия записи")
  .transform((s) => new Date(s));

// ───── Серверная пагинация (NFR-21) ─────

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export const zPagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type Pagination = z.infer<typeof zPagination>;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function skipTake(p: Pagination) {
  return { skip: (p.page - 1) * p.pageSize, take: p.pageSize };
}

// ───── Разбор входа ─────

export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** Валидирует данные схемой. при ошибке бросает ValidationError с ошибками полей. */
export function parseInput<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const res = schema.safeParse(data);
  if (!res.success) throw new ValidationError(undefined, zodFieldErrors(res.error));
  return res.data;
}

/** URLSearchParams → объект (для zod-схем фильтров списков). Пустые значения отбрасываются. */
export function searchParamsToObject(sp: URLSearchParams | Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  if (sp instanceof URLSearchParams) {
    sp.forEach((v, k) => {
      if (v !== "") out[k] = v;
    });
  } else {
    for (const [k, v] of Object.entries(sp)) {
      const val = Array.isArray(v) ? v[0] : v;
      if (val !== undefined && val !== "") out[k] = val;
    }
  }
  return out;
}

const UUID_ANY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Идентификатор записи из URL: не-UUID трактуется как отсутствующая запись (404), а не ошибка сервера. */
export function assertRecordId(id: string): void {
  if (!UUID_ANY_RE.test(id)) throw new NotFoundError();
}
