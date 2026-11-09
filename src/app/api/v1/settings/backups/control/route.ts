import { api, readJson } from "@/server/api-handler";
import { backupControlCommand, backupControlStatus } from "@/modules/desktop-backup/application/backup-control";
export const runtime = "nodejs";
export const GET = api({ access: "manager" }, ({ actor }) => backupControlStatus(actor));
export const POST = api({ access: "manager", allowOnStandby: true }, async ({ actor, req }) => backupControlCommand(actor, await readJson(req)));
