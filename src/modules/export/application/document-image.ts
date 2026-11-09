import sharp from "sharp";
import type { Actor } from "@/modules/auth/domain/actor";
import { openDocumentForDownload } from "@/modules/documents/application/document-service";
export async function documentImage(actor: Actor, id: string): Promise<Buffer> {
  const file = await openDocumentForDownload(actor, id);
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.mimeType)) throw new Error("Unsupported document image");
  const chunks: Buffer[] = [];
  for await (const chunk of file.stream) chunks.push(Buffer.from(chunk));
  return sharp(Buffer.concat(chunks), { limitInputPixels: 40_000_000 }).rotate().resize({ width: 900, withoutEnlargement: true }).png().toBuffer();
}
