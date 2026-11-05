import { z } from "zod";
import { api } from "@/server/api-handler";
import { parseInput } from "@/shared/validation";
import { browserSessions } from "@/modules/browser-sessions/application/dependencies";
export const runtime = "nodejs";
const frameQuery = z.object({ after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional() });
export const GET = api<{ id: string }>({}, async ({ actor, params, req }) => {
  const after = req.nextUrl.searchParams.get("after");
  const query = parseInput(frameQuery, after === null ? {} : { after });
  return browserSessions().frame(actor, params.id, query.after, req.signal);
});
