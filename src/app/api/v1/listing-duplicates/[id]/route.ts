import { api } from "@/server/api-handler";
import { getDuplicateGroup } from "@/modules/listing-duplicates/application/duplicate-service";
export const GET = api<{ id: string }>({}, async ({ actor, params }) => getDuplicateGroup(actor, params.id));
