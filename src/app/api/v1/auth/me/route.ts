import { api } from "@/server/api-handler";

export const GET = api({ access: "authenticated", allowPasswordChange: true }, async ({ actor }) => ({
  id: actor.userId,
  login: actor.login,
  displayName: actor.displayName,
  role: actor.role,
  mustChangePassword: actor.mustChangePassword,
}));
