import { api } from "@/server/api-handler";
import { listActiveUsersBrief } from "@/modules/users/application/users-service";

export const GET = api({}, async () => ({ items: await listActiveUsersBrief() }));
