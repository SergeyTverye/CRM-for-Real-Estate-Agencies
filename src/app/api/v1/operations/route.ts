import { api } from "@/server/api-handler";
import { getOperationsStatus } from "@/modules/operations/application/operations-service";

export const GET = api({ access: "manager" }, async ({ actor }) => getOperationsStatus(actor));
