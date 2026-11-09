import { readiness } from "@/modules/operations/application/health";

export const dynamic = "force-dynamic";


export async function GET() {
  const report = await readiness();
  return Response.json(report, { status: report.status === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } });
}
