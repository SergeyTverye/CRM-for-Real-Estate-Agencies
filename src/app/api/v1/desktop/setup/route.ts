import { api, readJson } from "@/server/api-handler";
import { completeDesktopSetup, desktopSetupStatus } from "@/modules/desktop-setup/application/setup-service";
export const GET = api({ access: "public" }, async () => desktopSetupStatus());
export const POST = api({ access: "public" }, async ({ req }) => completeDesktopSetup(await readJson(req)));
