import { z } from "zod";
import { SearchFilters } from "@/modules/property-search/domain/types";

/** Canonical schema published by the property-search agent (currently in domain/types.ts). */
export const searchFiltersSchema = SearchFilters;
export type AiSearchFilters = z.infer<typeof searchFiltersSchema>;
export const parseResultSchema = z.object({
  filters: searchFiltersSchema.nullable(),
  clarificationQuestion: z.string().trim().min(1).max(500).nullable(),
}).strict().refine((r) => r.filters !== null || r.clarificationQuestion !== null, "Нужны фильтры или уточнение");

export const descriptionInputSchema = z.object({
  listings: z.array(z.object({ id: z.string().min(1).max(100), publicDescription: z.string().max(20000) }).strict()).min(1).max(20),
  unresolvedCriteria: z.array(z.string().min(1).max(200)).min(1).max(30),
}).strict();
export const descriptionResultSchema = z.object({
  evidence: z.array(z.object({
    listingId: z.string().min(1).max(100), criterion: z.string().min(1).max(200),
    result: z.enum(["matched", "contradicted", "unknown"]),
    quote: z.string().max(1000).nullable(),
  }).strict()).max(600),
}).strict();
export const webResultSchema = z.object({
  candidates: z.array(z.object({ title: z.string().min(1).max(500), url: z.string().max(2048).nullable() }).strict()).max(50),
}).strict();

export type CallType = "parse" | "description" | "web_search";
export interface TokenUsage { inputTokens: number; outputTokens: number }
export interface WebSearchTool {
  type: "web_search";
  search_context_size: "low" | "medium" | "high";
  filters: { allowed_domains?: string[]; user_location?: { region: string } };
}
export interface AiRequest { model: string; instructions: string; input: string; maxOutputTokens: number; tools?: WebSearchTool[]; responseSchema?: Record<string, unknown>; responseSchemaStrict?: boolean }
export interface AiResponse {
  text: string; model: string; usage?: TokenUsage; webSearchCalls: number; sourceUrls: string[];
  mode: "live" | "test";
}
export interface ResponsesProvider { readonly mode: "live" | "test"; respond(request: AiRequest): Promise<AiResponse> }
export class AiError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "AiError"; }
}

/** Removes contact data, including spaced Russian phone numbers; never accepts a Client DTO. */
export function redactContacts(text: string): string {
  return text.replace(/[\w.+%-]+@[\p{L}\d.-]+\.[\p{L}]{2,}/gu, "[EMAIL]")
    .replace(/(?<!\d)(?:\+?\d[\s().-]*){6,14}\d(?!\d)/g, (value, offset: number, full: string) => {
      // Preserve explicit public prices/areas and short bare numbers (e.g. 10000000 RUB).
      if (/^\s*(?:₽|руб|м²|м2|кв\.?\s*м)/iu.test(full.slice(offset + value.length))) return value;
      const digits = value.replace(/\D/g, "");
      return digits.length >= 10 || (digits.length === 7 && /[()-]/.test(value)) ? "[PHONE]" : value;
    });
}

/** This validates provenance syntax only. A downstream SSRF-safe fetch must verify the listing. */
export function publicSourceUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || u.port || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)) return null;
    if (/(^|\.)(localhost|local|internal|test|invalid)$/i.test(u.hostname)) return null;
    u.hash = "";
    return u.href;
  } catch { return null; }
}
