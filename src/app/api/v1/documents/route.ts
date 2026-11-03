import { api, json } from "@/server/api-handler";
import { listDocumentsFor, uploadDocument, LINK_KINDS, type LinkKind } from "@/modules/documents/application/document-service";
import { NotFoundError, ValidationError } from "@/shared/errors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = api({}, async ({ req, actor }) => {
  const kind = req.nextUrl.searchParams.get("linkKind") as LinkKind | null;
  const id = req.nextUrl.searchParams.get("linkId");
  if (!kind || !LINK_KINDS.includes(kind) || !id || !UUID_RE.test(id)) throw new NotFoundError();
  return { items: await listDocumentsFor(actor, { kind, id }) };
});

/** Загрузка файла: multipart/form-data с полями file, documentTypeCode, linkKind, linkId[, legalEntityId]. */
export const POST = api({}, async ({ req, actor }) => {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) throw new ValidationError("Ожидается multipart/form-data");
  const form = await req.formData();
  const file = form.get("file");
  const meta = {
    documentTypeCode: form.get("documentTypeCode"),
    linkKind: form.get("linkKind"),
    linkId: form.get("linkId"),
    legalEntityId: form.get("legalEntityId") || undefined,
  };
  return json(await uploadDocument(actor, file instanceof File ? file : null, meta), 201);
});
