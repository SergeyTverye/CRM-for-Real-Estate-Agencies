import { api } from "@/server/api-handler";
import { pickProperties } from "@/modules/properties/application/property-queries";

export const GET = api({}, async ({ req }) => ({ items: await pickProperties(req.nextUrl.searchParams.get("q") ?? undefined) }));
