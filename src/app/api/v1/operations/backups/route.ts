import { api, json } from "@/server/api-handler";
import { startManualBackup } from "@/modules/operations/application/operations-service";


export const POST = api({ access: "manager", allowOnStandby: true }, async ({ actor }) => json(await startManualBackup(actor), 202));
