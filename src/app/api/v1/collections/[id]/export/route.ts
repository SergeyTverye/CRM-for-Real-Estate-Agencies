import { api } from "@/server/api-handler";
import { exportCollection } from "@/modules/collections/application/export-service";
export const GET = api<{id:string}>({}, async ({ actor, params, req }) => {
  const result = await exportCollection(actor, params.id, { format: req.nextUrl.searchParams.get("format") ?? "csv" });
  return new Response(Buffer.from(result.bytes), { headers: { "content-type": result.contentType, "content-disposition": `attachment; filename="${result.filename}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
});
