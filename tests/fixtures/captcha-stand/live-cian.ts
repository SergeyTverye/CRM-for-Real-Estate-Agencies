/** Explicit one-shot diagnostic, NEVER part of automatic tests. Does not solve or resume CAPTCHA. */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { BrowserSessionService } from "@/modules/browser-sessions/application/session-service";
import { MemorySessionRepository } from "@/modules/browser-sessions/infrastructure/memory-repository";
import { PlaywrightSessionBrowser } from "@/modules/browser-sessions/infrastructure/playwright-browser";
import type { BrowserHandle } from "@/modules/browser-sessions/domain/session";

async function main() {
  let handle: BrowserHandle | undefined;
  const factory = new PlaywrightSessionBrowser();
  const service = new BrowserSessionService(new MemorySessionRepository(), { open: async (...args) => { handle = await factory.open(...args); return handle; } }, {
    prepare: async () => ({ startUrl: "https://www.cian.ru/cat.php?deal_type=sale&engine_version=2&offer_type=offices&office_type%5B0%5D=1&region=4897", parameters: { diagnosticOnly: true } }),
    isReady: async () => false, resume: async () => { throw new Error("DIAGNOSTIC_NEVER_RESUMES"); }, blocked: async () => undefined,
  }, async () => undefined);
  const evidence: Record<string, unknown> = { mode: "LIVE", at: new Date().toISOString(), source: "cian", attempts: 1, solved: false, resumed: false };
  try {
    await service.create({ userId: "10000000-0000-4000-8000-000000000001", sessionId: "synthetic-diagnostic", role: "realtor", login: "diagnostic", displayName: "Диагностика", mustChangePassword: false },
      { searchRunId: "20000000-0000-4000-8000-000000000001", source: "cian" });
    if (!handle) throw new Error("NO_HANDLE");
    const text = await handle.page.locator("body").innerText({ timeout: 3000 });
    evidence.challengeVisible = /captcha|капч|подтвердите.{0,60}человек|проверка.{0,40}(браузер|безопасност)|доступ.{0,20}ограничен/iu.test(text);
    evidence.accessBlocked = /подозрительн.{0,20}трафик|cian_waf_block|доступ.{0,20}ограничен/iu.test(text);
    evidence.status = evidence.challengeVisible || evidence.accessBlocked ? "BLOCKED" : "OPENED_NO_VISIBLE_CHALLENGE";
    evidence.frameAvailable = !!handle.frame();
    await mkdir("docs/integrations", { recursive: true });
    await handle.page.screenshot({ path: "docs/integrations/captcha-hitl-cian-live.png", fullPage: false });
    evidence.screenshot = "captcha-hitl-cian-live.png";
  } catch { evidence.status = "UNAVAILABLE"; evidence.challengeVisible = null; }
  finally { await service.shutdown(); }
  await writeFile("docs/integrations/captcha-hitl-cian-live.json", `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}
void main();
