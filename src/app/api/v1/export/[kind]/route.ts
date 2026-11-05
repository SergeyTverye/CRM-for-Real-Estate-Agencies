import { api } from "@/server/api-handler";
import { searchParamsToObject } from "@/shared/validation";
import { exportRegister } from "@/modules/export/application/register-export";
export const GET = api<{ kind: string }>({}, async ({ actor, req, params }) => {
  const out = await exportRegister(actor, params.kind, searchParamsToObject(req.nextUrl.searchParams));
  return new Response(out.csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${out.fileName}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
});
