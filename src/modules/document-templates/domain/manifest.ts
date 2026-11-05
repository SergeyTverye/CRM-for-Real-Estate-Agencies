import { z } from "zod";
import { parseDocument } from "yaml";
import { ValidationError } from "@/shared/errors";

export const KINDS = ["client", "need", "deal", "offer", "collection", "property"] as const;
export type EntityKind = typeof KINDS[number];
export const FORMATS = ["markdown_docx", "docx", "xlsx", "xlsx_registry"] as const;
export const LIMITS = { input: 5_000_000, expanded: 20_000_000, text: 500_000, iterations: 1000, depth: 8, records: 200 };
export const FIELD_CATALOG = {
  "client.displayName": "text", "client.kind": "text", "client.status": "text",
  "need.operationType": "text", "need.budgetMax": "money", "need.areaMin": "area", "need.areaMax": "area",
  "deal.date": "date", "deal.price": "money", "deal.status": "text",
  "offer.title": "text", "offer.date": "date", "offer.introText": "text",
  "collection.name": "text", "property.address": "text", "property.area": "area", "property.price": "money",
  "properties.address": "text", "properties.area": "area", "properties.price": "money",
  "legalEntity.displayName": "text", "legalEntity.requisites": "text", "user.displayName": "text",
} as const;
export type FieldPath = keyof typeof FIELD_CATALOG;
const SOURCES: Record<EntityKind, string[]> = {
  client: ["client", "user"], need: ["client", "need", "user"],
  deal: ["deal", "property", "legalEntity", "user"],
  offer: ["client", "need", "offer", "properties", "legalEntity", "user"],
  collection: ["collection", "properties", "user"], property: ["property", "user"],
};
const field = z.object({ path: z.string().max(100), label: z.string().min(1).max(150), type: z.enum(["text", "date", "money", "area"]), required: z.boolean().default(false), roles: z.array(z.enum(["manager", "realtor"])).min(1).default(["manager", "realtor"]) }).strict();
const schema = z.object({ schemaVersion: z.literal(1), entityKind: z.enum(KINDS), sources: z.array(z.string()).min(1).max(8), fields: z.array(field).min(1).max(50), columns: z.array(z.object({ path: z.string(), title: z.string().min(1).max(100), width: z.number().min(8).max(80).default(25) }).strict()).max(30).optional() }).strict();
export type Manifest = z.infer<typeof schema>;
export function fail(message: string): never { throw new ValidationError(message); }
export function parseManifest(yaml: string): Manifest {
  if (Buffer.byteLength(yaml) > 50_000) fail("Манифест превышает 50 КБ");
  let raw: unknown;
  try {
    const doc = parseDocument(yaml, { uniqueKeys: true, customTags: [], schema: "core" });
    if (doc.errors.length) fail("Некорректный YAML");
    raw = doc.toJS({ maxAliasCount: 0 });
  } catch { fail("Некорректный YAML: ссылки и пользовательские теги запрещены"); }
  const result = schema.safeParse(raw);
  if (!result.success) fail("Некорректная структура манифеста полей");
  const m = result.data;
  if (new Set(m.fields.map(f => f.path)).size !== m.fields.length) fail("Поля манифеста повторяются");
  for (const source of m.sources) if (!SOURCES[m.entityKind].includes(source)) fail("Источник запрещён для типа документа");
  for (const f of m.fields) {
    if (!Object.hasOwn(FIELD_CATALOG, f.path) || FIELD_CATALOG[f.path as FieldPath] !== f.type || !m.sources.includes(f.path.split(".")[0]!)) fail("Поле отсутствует в типизированном белом списке");
    if (f.path === "legalEntity.requisites" && f.roles.includes("realtor")) fail("Реквизиты в шаблонах доступны только руководителю");
  }
  for (const c of m.columns ?? []) if (!m.fields.some(f => f.path === c.path) || c.path.startsWith("properties.")) fail("Колонка должна ссылаться на скалярное поле манифеста");
  return m;
}
