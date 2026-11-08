import { api, readJson } from "@/server/api-handler";
import { aiCredentialsService } from "@/modules/ai/application/credentials-service";
export const GET = api({ access: "manager" }, async ({ actor }) => aiCredentialsService().status(actor));
export const PUT = api({ access: "manager" }, async ({ actor, req }) => aiCredentialsService().replace(actor, await readJson(req)));
export const DELETE = api({ access: "manager" }, async ({ actor }) => aiCredentialsService().remove(actor));
