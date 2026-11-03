import { Readable } from "node:stream";
import { api } from "@/server/api-handler";
import { openDocumentForDownload } from "@/modules/documents/application/document-service";

function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Выдача файла только после серверной проверки доступа к связанной сущности (UC-08). */
export const GET = api<{ id: string }>({}, async ({ actor, params }) => {
  const f = await openDocumentForDownload(actor, params.id);
  return new Response(Readable.toWeb(f.stream) as ReadableStream, {
    status: 200,
    headers: {
      "content-type": f.mimeType,
      "content-length": String(f.size),
      "content-disposition": contentDisposition(f.fileName),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
});
