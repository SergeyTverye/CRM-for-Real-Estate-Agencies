import { load } from "cheerio";
import type { Source } from "../domain/types";

export interface ListingDates {
  publishedAt: string | null;
  sourceUpdatedAt: string | null;
  dateSource: string;
  datePrecision: "exact" | "day" | "unknown";
}
const unknown: ListingDates = { publishedAt: null, sourceUpdatedAt: null, dateSource: "unknown", datePrecision: "unknown" };
const DAY = 86_400_000;
/** Calendar labels are source-local days, never the host's local timezone. */
export function parseSourceDate(value: unknown, fetchedAt: string): { at: string; precision: "exact" | "day" } | null {
  if (typeof value === "number") {
    const ms = value < 1e12 ? value * 1000 : value;
    return Number.isFinite(ms) && ms >= Date.UTC(2000, 0, 1) && ms <= Date.parse(fetchedAt) + DAY ? { at: new Date(ms).toISOString(), precision: "exact" } : null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim().toLocaleLowerCase("ru");
  const local = new Date(Date.parse(fetchedAt) + 7 * 3600_000);
  let days: number | undefined;
  if (/^сегодня(?:\s|,|$)/u.test(text)) days = 0;
  else if (/^вчера(?:\s|,|$)/u.test(text)) days = 1;
  else { const m = text.match(/^(\d+)\s+(?:день|дня|дней)\s+назад$/u); if (m) days = Number(m[1]); }
  if (days !== undefined) {
    if (!Number.isSafeInteger(days) || days > 36500) return null;
    const clock = text.match(/(?:в\s*)?(\d{1,2}):(\d{2})/u);
    if (clock && (Number(clock[1]) > 23 || Number(clock[2]) > 59)) return null;
    const ms = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - days, clock ? Number(clock[1]) : 0, clock ? Number(clock[2]) : 0) - 7 * 3600_000;
    return { at: new Date(ms).toISOString(), precision: clock ? "exact" : "day" };
  }
  const absolute = text.match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/u);
  const russian = text.match(/^(\d{1,2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/u);
  if (russian) return parseSourceDate(`${russian[3]}-${russian[2]}-${russian[1]!.padStart(2, "0")}${russian[4] ? `T${russian[4]!.padStart(2, "0")}:${russian[5]}:00+07:00` : ""}`, fetchedAt);
  const named = text.match(/^(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+(\d{4}))?(?:,?\s+(?:в\s+)?(\d{1,2}):(\d{2}))?$/u);
  if (named) {
    const month = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"].indexOf(named[2]!) + 1;
    let year = Number(named[3] ?? local.getUTCFullYear());
    if (!named[3] && Date.UTC(year, month - 1, Number(named[1])) > local.getTime()) year--;
    return parseSourceDate(`${year}-${String(month).padStart(2, "0")}-${named[1]!.padStart(2, "0")}${named[4] ? `T${named[4]!.padStart(2, "0")}:${named[5]}:00+07:00` : ""}`, fetchedAt);
  }
  if (!absolute) return null;
  const [, y, m, d, suffix] = absolute;
  const check = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (check.getUTCMonth() !== Number(m) - 1 || check.getUTCDate() !== Number(d)) return null;
  // An unspecified source clock is interpreted in the mandated source timezone.
  const iso = !suffix ? `${text}T00:00:00+07:00` : /(?:z|[+-]\d\d:\d\d)$/iu.test(text) ? text : `${text}+07:00`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && ms <= Date.parse(fetchedAt) + DAY ? { at: new Date(ms).toISOString(), precision: suffix ? "exact" : "day" } : null;
}

const publishedKeys = ["datePublished", "publishedAt", "published_at", "publicationDate", "creation-date", "creationDate", "createdAt", "created_at"];
const updatedKeys = ["dateModified", "sourceUpdatedAt", "updatedAt", "updated_at", "last-update-date", "updateDate", "modificationDate"];
/** Read inert JSON assigned in SSR scripts, including bare undefined outside strings. */
function embeddedJson(text: string): unknown[] {
  const results: unknown[] = [];
  const starts = /(?:=|\(|^)\s*([\[{])/gu;
  for (const match of text.matchAll(starts)) {
    const start = match.index! + match[0].length - 1;
    let quoted = false, escaped = false, depth = 0, json = "";
    for (let i = start; i < text.length; i++) {
      const ch = text[i]!;
      if (!quoted && text.slice(i, i + 9) === "undefined" && !/[\p{L}\p{N}_]/u.test(text[i + 9] ?? "")) { json += "null"; i += 8; continue; }
      json += ch;
      if (quoted) { if (escaped) escaped = false; else if (ch === "\\") escaped = true; else if (ch === '"') quoted = false; }
      else if (ch === '"') quoted = true;
      else if (ch === "[" || ch === "{") depth++;
      else if (ch === "]" || ch === "}") { if (--depth === 0) { try { results.push(JSON.parse(json)); } catch { /* Not JSON, never execute it. */ } break; } }
    }
    if (results.length >= 20) break;
  }
  return results;
}
/** Only a node bound to this listing's ID/URL may supply a date. No page-wide date guessing. */
export function extractListingDates(source: Source, payload: unknown, identity: { id?: string | null; url: string }, fetchedAt: string): ListingDates {
  const result = { ...unknown };
  let visits = 0;
  const assign = (node: Record<string, unknown>, via: string) => {
    const pub = publishedKeys.map(k => parseSourceDate(node[k], fetchedAt)).find(Boolean);
    const upd = updatedKeys.map(k => parseSourceDate(node[k], fetchedAt)).find(Boolean);
    if (pub && !result.publishedAt) { result.publishedAt = pub.at; result.datePrecision = pub.precision; result.dateSource = `${source}:${via}:publication`; }
    if (upd && !result.sourceUpdatedAt) { result.sourceUpdatedAt = upd.at; if (!result.publishedAt) { result.datePrecision = upd.precision; result.dateSource = `${source}:${via}:update`; } }
  };
  const walk = (value: unknown, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 35 || ++visits > 50000) return;
    if (Array.isArray(value)) { value.forEach(v => walk(v, depth + 1)); return; }
    const n = value as Record<string, unknown>;
    const ids = [n.id, n.cianId, n.offerId, n.productId];
    const urls = [n.url, n.fullUrl, n.urlPath];
    if (identity.id && ids.some(id => String(id) === identity.id) || urls.some(u => { try { return typeof u === "string" && new URL(u, identity.url).pathname === new URL(identity.url).pathname; } catch { return false; } })) assign(n, "structured");
    Object.values(n).forEach(v => walk(v, depth + 1));
  };
  if (typeof payload !== "string") { walk(payload); return result; }
  const $ = load(payload);
  $("script:not([src])").each((_, el) => {
    const text = $(el).text().trim();
    try { walk(JSON.parse(text)); } catch { embeddedJson(text).forEach(value => walk(value)); }
  });
  $("[data-state],[data-bem]").each((_, el) => { for (const attr of ["data-state", "data-bem"]) { try { walk(JSON.parse($(el).attr(attr) ?? "")); } catch { /* Not JSON. */ } } });
  $("a[href]").each((_, el) => {
    let matches = false;
    try { matches = new URL($(el).attr("href")!, identity.url).pathname === new URL(identity.url).pathname; } catch { return; }
    if (!matches) return;
    const card = $(el).closest("article,[data-id],[data-name='CardComponent'],[data-testid='offer-card'],.ad-item-container,.offer-card,.card");
    if (!card.length) return;
    card.find("[itemprop='datePublished'],[itemprop='dateModified'],time,[data-testid*='date'],[data-marker*='date'],[class*='date'],[class*='Date'],[class*='publish'],[class*='update']").each((_, date) => {
      const element = $(date), label = element.text().trim();
      const update = element.attr("itemprop") === "dateModified" || /обновлен|обновлён|update/iu.test(label + " " + element.attr("class"));
      const explicitPublication = element.attr("itemprop") === "datePublished" || /опубликован|размещен|размещён/iu.test(label);
      if (!update && !explicitPublication) return; // Unlabelled date may be a promotion.
      assign({ [update ? "dateModified" : "datePublished"]: element.attr("datetime") || element.attr("content") || label.replace(/^.*?(?:сегодня|вчера|\d+\s+(?:день|дня|дней)\s+назад)/iu, match => match.match(/сегодня|вчера|\d+\s+(?:день|дня|дней)\s+назад/iu)![0]) }, "html_label");
    });
  });
  return result;
}
