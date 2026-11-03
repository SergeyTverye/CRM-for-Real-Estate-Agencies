import { api, json } from "@/server/api-handler";
import { listImportJobs, uploadImport } from "@/modules/import/application/import-service";
import { ValidationError } from "@/shared/errors";

export const GET = api({ access: "manager" }, async ({ actor }) => ({ items: await listImportJobs(actor) }));

/** Загрузка файла и dry-run: multipart/form-data с полем file (.xlsx). */
export const POST = api({ access: "manager" }, async ({ req, actor }) => {
  if (!(req.headers.get("content-type") ?? "").includes("multipart/form-data")) throw new ValidationError("Ожидается multipart/form-data");
  const form = await req.formData();
  const file = form.get("file");
  return json(await uploadImport(actor, file instanceof File ? file : null), 201);
});
