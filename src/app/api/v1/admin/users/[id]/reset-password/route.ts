import { api } from "@/server/api-handler";
import { resetUserPassword } from "@/modules/users/application/users-service";

export const POST = api<{ id: string }>({ access: "manager" }, async ({ actor, params }) => resetUserPassword(actor, params.id));
