import { api, json } from "@/server/api-handler";
import { logout } from "@/modules/auth/application/auth-service";
import { SESSION_COOKIE } from "@/modules/auth/infrastructure/session-token";

export const POST = api({ access: "public", allowOnStandby: true }, async ({ actor }) => {
  if (actor) await logout(actor);
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
});
