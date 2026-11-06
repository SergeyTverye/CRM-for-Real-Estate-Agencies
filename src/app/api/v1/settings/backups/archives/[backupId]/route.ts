import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { api } from "@/server/api-handler";
import { archivePath } from "@/modules/desktop-backup/application/backup-control";
export const runtime = "nodejs";
export const GET = api<{ backupId: string }>({ access: "manager" }, async ({ params }) => {
  const file = await archivePath(params.backupId);
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${params.backupId}.crmbackup"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
});
