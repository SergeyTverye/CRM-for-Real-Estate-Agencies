import { api, json } from "@/server/api-handler";
import { startManualBackup } from "@/modules/operations/application/operations-service";

/** Ручной локальный backup. Разрешён на standby-узле: снимок не меняет бизнес-данные. */
export const POST = api({ access: "manager", allowOnStandby: true }, async ({ actor }) => json(await startManualBackup(actor), 202));
