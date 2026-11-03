import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/** Versioned import profiles (ТЗ 38.2): JSON-файлы в import-profiles/, проверяются схемой при загрузке. */
export const profileSchema = z.object({
  code: z.string().regex(/^[a-z_]+_v\d+$/),
  version: z.string(),
  title: z.string(),
  target: z.enum(["historical_deal_archive", "property", "client_request_need", "property_agreement_control"]),
  markers: z.array(z.string().min(2)).min(1),
  requiredHeaders: z.array(z.string()).min(1),
  defaults: z.record(z.string(), z.string()).default({}),
  columns: z.record(z.string(), z.string()),
  excludedByPolicy: z.array(z.string()).default([]),
  unresolved: z.array(z.string()).default([]),
  functionMap: z.record(z.string(), z.string()).optional(),
  stateMap: z.record(z.string(), z.string()).optional(),
});

export type ImportProfile = z.infer<typeof profileSchema>;

export const WORKBOOK_PROFILE_CODE = "enterprise_workbook_v1";

let cache: ImportProfile[] | null = null;

export function profilesDir(): string {
  return path.resolve(process.cwd(), "import-profiles");
}

export function loadProfiles(dir = profilesDir()): ImportProfile[] {
  if (cache && dir === profilesDir()) return cache;
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const profiles = files.map((f) => profileSchema.parse(JSON.parse(readFileSync(path.join(dir, f), "utf8"))));
  if (dir === profilesDir()) cache = profiles;
  return profiles;
}

/** Версия mapping набора профилей (фиксируется в import_jobs.mapping_version). */
export function mappingVersion(profiles: ImportProfile[]): string {
  return profiles.map((p) => `${p.code}@${p.version}`).join(",");
}

export function normalizeHeader(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\s ]+/g, " ")
    .replace(/\s*([/,.:()-])\s*/g, "$1")
    .replace(/:$/, "")
    .trim();
}
