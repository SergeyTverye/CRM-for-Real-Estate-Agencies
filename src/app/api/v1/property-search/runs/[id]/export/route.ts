import { api, readJson } from "@/server/api-handler";
import { exportSearch } from "@/modules/property-search/application/export-service";
function response(result: Awaited<ReturnType<typeof exportSearch>>) {
  return new Response(Buffer.from(result.bytes), { headers: { "content-type": result.contentType, "content-disposition": `attachment; filename=${result.filename}`, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "x-search-export-id": result.exportId } });
}
export const GET = api<{ id: string }>({}, async ({ actor, params, req }) => response(await exportSearch(actor, params.id, { format: req.nextUrl.searchParams.get("format") ?? "csv" })));
export const POST = api<{ id: string }>({}, async ({ actor, params, req }) => response(await exportSearch(actor, params.id, await readJson(req))));
