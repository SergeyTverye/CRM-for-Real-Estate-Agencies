import { db, disconnectDb } from "@/shared/db/client";
import { hashPassword } from "@/modules/auth/infrastructure/password-hasher";
const displayName = "[ops synthetic] disposable restore login";
async function main() {
  const login = process.env.OPS_RESTORE_TEST_LOGIN ?? "";
  if (!/^ops_restore_[a-f0-9]{12}$/.test(login)) throw new Error("Invalid synthetic login");
  if (process.argv.includes("--remove")) {
    await db.user.deleteMany({ where: { login, displayName } });
    return;
  }
  const password = process.env.OPS_RESTORE_TEST_PASSWORD;
  if (!password || password.length < 24) throw new Error("Synthetic password required");
  await db.user.create({ data: { login, displayName, roleCode: "manager", mustChangePassword: false,
    passwordHash: await hashPassword(password) } });
}
main().catch(() => { console.error("ops.restore_login_fixture_failed"); process.exitCode = 1; }).finally(disconnectDb);
