import { api } from "@/server/api-handler";
import { previewResponsible } from "@/modules/requests/application/request-service";

export const GET = api({}, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const uuid = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  return previewResponsible(actor, { propertyId: uuid(sp.get("propertyId")), advertisementId: uuid(sp.get("advertisementId")) });
});
