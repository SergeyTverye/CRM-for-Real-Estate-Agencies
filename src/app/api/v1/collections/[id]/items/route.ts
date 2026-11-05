import { api, readJson } from "@/server/api-handler";
import { addItems } from "@/modules/collections/application/collection-service";
export const POST = api<{id:string}>({}, async ({ actor, params, req }) => {
  const body = await readJson(req) as {items?:unknown};
  return addItems(actor, params.id, body?.items);
});
