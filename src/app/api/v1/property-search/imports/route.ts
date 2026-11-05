import { api } from "@/server/api-handler";
import { ValidationError } from "@/shared/errors";
import { importSearchFeed } from "@/modules/property-search/application/manual-import-service";
export const POST = api({}, async ({ actor, req }) => {
  if (Number(req.headers.get("content-length")) > 11000000) throw new ValidationError("Файл слишком велик");
  const form = await req.formData(), file = form.get("file");
  if (!(file instanceof File)) throw new ValidationError("Выберите файл");
  let filters: unknown;
  try { filters = JSON.parse(String(form.get("filters"))); } catch { throw new ValidationError("Некорректные фильтры"); }
  return importSearchFeed(actor, file, { source: form.get("source"), format: form.get("format"), filters, commit: form.get("commit") === "true" });
});
