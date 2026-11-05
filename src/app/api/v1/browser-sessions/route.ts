import { api, readJson } from "@/server/api-handler";
import { browserSessions } from "@/modules/browser-sessions/application/dependencies";
export const runtime = "nodejs";
export const POST = api({}, async ({ actor, req }) => browserSessions().create(actor, await readJson(req)));
