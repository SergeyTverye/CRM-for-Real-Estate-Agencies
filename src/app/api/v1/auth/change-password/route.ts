import { z } from "zod";
import { api, readJson } from "@/server/api-handler";
import { changeOwnPassword } from "@/modules/auth/application/auth-service";
import { parseInput } from "@/shared/validation";

const schema = z.object({ currentPassword: z.string().max(200), newPassword: z.string().max(200) });

export const POST = api({ access: "authenticated", allowPasswordChange: true, allowOnStandby: true }, async ({ req, actor }) => {
  const body = parseInput(schema, await readJson(req));
  await changeOwnPassword(actor, body.currentPassword, body.newPassword);
  return { ok: true };
});
