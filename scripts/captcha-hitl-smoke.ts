import { productionCycle } from "../tests/fixtures/captcha-stand/production-cycle";
import { disconnectDb } from "@/shared/db/client";
async function main() {
try {
  for (const mode of ["success", "expired", "cancelled", "blocked", "foreign", "restart"] as const) console.log(JSON.stringify(await productionCycle(mode)));
} finally { await disconnectDb(); }
}
void main().catch(() => { console.error("CAPTCHA_HITL_SMOKE_FAILED: inspect the assertion locally; no browser secrets are logged"); process.exitCode = 1; });
