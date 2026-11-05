import { Readable } from "node:stream";
import type { Actor } from "@/modules/auth/domain/actor";
import { openPropertyMedia } from "@/modules/properties/application/property-media-service";

export async function propertyMediaResponse(actor: Actor, propertyId: string, documentId: string, thumbnail = false) {
  const file = await openPropertyMedia(actor, propertyId, documentId, thumbnail);
  return new Response(Readable.toWeb(file.stream) as ReadableStream, { headers: {
    "content-type": file.mimeType, "content-length": String(file.size),
    "content-disposition": `${file.inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    "x-content-type-options": "nosniff", "cache-control": "private, no-store",
    "content-security-policy": "default-src 'none'; sandbox",
  } });
}
