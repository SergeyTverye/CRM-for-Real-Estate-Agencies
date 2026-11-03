/**
 * Время и часовой пояс (ТЗ 40.11): в БД — timestamptz/UTC, в интерфейсе —
 * локальное время экземпляра APP_TIMEZONE. Календарные даты — date (UTC-полночь).
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

function partsInTz(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) if (p.type !== "literal") map[p.type] = Number(p.value);
  return { year: map.year!, month: map.month!, day: map.day!, hour: map.hour!, minute: map.minute!, second: map.second! };
}

/** Смещение часового пояса (мс) в указанный момент. */
export function tzOffsetMs(date: Date, timeZone: string): number {
  const p = partsInTz(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** UTC-момент локальной полуночи дня, в который попадает `date` в часовом поясе tz. */
export function startOfDayInTz(date: Date, timeZone: string): Date {
  const p = partsInTz(date, timeZone);
  const guess = Date.UTC(p.year, p.month - 1, p.day);
  const offset = tzOffsetMs(new Date(guess), timeZone);
  const result = guess - offset;
  // Коррекция на случай перехода смещения внутри суток.
  const offset2 = tzOffsetMs(new Date(result), timeZone);
  return new Date(guess - offset2);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Локальная календарная дата 'YYYY-MM-DD' момента в часовом поясе. */
export function localDateString(date: Date, timeZone: string): string {
  const p = partsInTz(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Значение PostgreSQL date (UTC-полночь) → 'YYYY-MM-DD'. */
export function dateOnlyString(date: Date | null | undefined): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** Сегодняшняя дата в часовом поясе как Date для сравнения с колонками date. */
export function todayAsDateOnly(now: Date, timeZone: string): Date {
  return new Date(`${localDateString(now, timeZone)}T00:00:00.000Z`);
}

export function formatDateTime(value: Date | string | null | undefined, timeZone: string): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatDate(value: Date | string | null | undefined, timeZone: string): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value) : value;
  const isDateOnly = typeof value === "string" && value.length === 10;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: isDateOnly ? "UTC" : timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

/** Значение для <input type="datetime-local"> в часовом поясе экземпляра. */
export function toDateTimeLocalValue(value: Date | string | null | undefined, timeZone: string): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  const p = partsInTz(d, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** 'YYYY-MM-DDTHH:mm' в часовом поясе экземпляра → ISO UTC. */
export function fromDateTimeLocalValue(value: string, timeZone: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return value;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  const offset = tzOffsetMs(new Date(guess), timeZone);
  const result = guess - offset;
  const offset2 = tzOffsetMs(new Date(result), timeZone);
  return new Date(guess - offset2).toISOString();
}
