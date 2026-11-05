import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { fail, LIMITS } from "../domain/manifest";
import { MIME } from "../domain/renderers";
export async function readTemplateForm(req: NextRequest) {
  if (!req.headers.get("content-type")?.includes("multipart/form-data")) fail("Ожидается multipart/form-data");
  if (Number(req.headers.get("content-length")) > LIMITS.input + 600_000) fail("Размер запроса превышен");
  const reader = req.body?.getReader(); if (!reader) fail("Пустой запрос");
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > LIMITS.input + 600_000) { await reader.cancel(); fail("Размер запроса превышен"); } chunks.push(next.value); }
  const form = await new Response(Buffer.concat(chunks), { headers: { "content-type": req.headers.get("content-type")! } }).formData(), file = form.get("file");
  const raw: Record<string, unknown> = {};
  for (const key of ["code", "name", "format", "description", "manifestYaml", "markdownBody", "compatibilityNote"]) if (form.has(key)) raw[key] = form.get(key);
  return { raw, file: file instanceof File && file.size ? file : null, expectedUpdatedAt: String(form.get("expectedUpdatedAt") ?? "") };
}
export function previewResponse(result: { data: Buffer; extension: "docx" | "xlsx" }) {
  return new Response(new Uint8Array(result.data), { headers: { "content-type": MIME[result.extension], "content-disposition": `attachment; filename="preview.${result.extension}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}
export function fileResponse(file: { stream: Readable; mimeType: string; fileName: string }) {
  return new Response(Readable.toWeb(file.stream) as ReadableStream, { headers: { "content-type": file.mimeType, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}
