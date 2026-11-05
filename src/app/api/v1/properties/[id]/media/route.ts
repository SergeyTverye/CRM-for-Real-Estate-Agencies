import { api, json } from "@/server/api-handler";
import { listPropertyMedia, uploadPropertyMedia } from "@/modules/properties/application/property-media-service";
import { ValidationError } from "@/shared/errors";

export const GET = api<{ id: string }>({}, async ({ actor, params, req }) => ({ items: await listPropertyMedia(actor, params.id, req.nextUrl.searchParams.get("archived") === "true") }));
export const POST = api<{ id: string }>({}, async ({ actor, params, req }) => {
  if (!req.headers.get("content-type")?.includes("multipart/form-data")) throw new ValidationError("Ожидается multipart/form-data");
  const form = await req.formData();
  const file = form.get("file");
  return json(await uploadPropertyMedia(actor, params.id, file instanceof File ? file : null, { kind: form.get("kind"), documentTypeCode: form.get("documentTypeCode") || undefined }), 201);
});
