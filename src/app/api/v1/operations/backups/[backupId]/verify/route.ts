import { api } from "@/server/api-handler";
import { verifyLocalBackup } from "@/modules/operations/application/operations-service";

export const POST = api<{ backupId: string }>({ access: "manager", allowOnStandby: true }, async ({ actor, params }) => verifyLocalBackup(actor, params.backupId));
