import { z } from "zod";
import { api, clientIp, isSecureRequest, json, readJson } from "@/server/api-handler";
import { login } from "@/modules/auth/application/auth-service";
import { SESSION_COOKIE } from "@/modules/auth/infrastructure/session-token";
import { parseInput } from "@/shared/validation";

const schema = z.object({ login: z.string().max(100), password: z.string().max(200) });

export const POST = api({ access: "public", allowOnStandby: true }, async ({ req }) => {
  const body = parseInput(schema, await readJson(req));
  const result = await login(body.login, body.password, { ip: clientIp(req), userAgent: req.headers.get("user-agent") });
  const res = json({ mustChangePassword: result.mustChangePassword });
  res.cookies.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    path: "/",
    expires: result.expiresAt,
  });
  return res;
});
