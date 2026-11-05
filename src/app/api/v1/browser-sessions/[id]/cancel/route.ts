import { api } from "@/server/api-handler";
import { browserSessions } from "@/modules/browser-sessions/application/dependencies";
export const runtime = "nodejs";
export const POST = api<{ id: string }>({}, async ({ actor, params }) => browserSessions().cancel(actor, params.id));
