export const dynamic = "force-dynamic";

/** Liveness: процесс жив и обрабатывает запросы (без обращения к БД). */
export function GET() {
  return Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
}
