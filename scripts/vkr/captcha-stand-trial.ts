import { chromium } from "playwright-core";
import { writeFile } from "node:fs/promises";
import { captchaStand } from "../../tests/fixtures/captcha-stand/server";
import { viewerHarness } from "../../tests/fixtures/captcha-stand/harness";
import { BrowserSessionService } from "@/modules/browser-sessions/application/session-service";
import { MemorySessionRepository } from "@/modules/browser-sessions/infrastructure/memory-repository";
import { PlaywrightSessionBrowser } from "@/modules/browser-sessions/infrastructure/playwright-browser";
import type { Actor } from "@/modules/auth/domain/actor";
import type { BrowserHandle } from "@/modules/browser-sessions/domain/session";
import assert from "node:assert/strict";

async function main() {
  const actor: Actor = {userId:"10000000-0000-4000-8000-000000000001",sessionId:"stand",displayName:"REPLAY: сотрудник стенда",role:"realtor",login:"stand",mustChangePassword:false};
  const stand = await captchaStand();
  const probe = await stand.network.transport(stand.origin+"/check");
  assert.ok(probe.data.includes("data-needs-user-action"));
  const factory = new PlaywrightSessionBrowser({network:stand.network});
  let handle: BrowserHandle | undefined;
  let continued = false;
  const service = new BrowserSessionService(new MemorySessionRepository(),{open:async(...args)=>{handle=await factory.open(...args);return handle;}},{
    prepare:async()=>({startUrl:stand.origin+"/check",parameters:{}}),
    isReady:async p=>await p.locator("[data-listing]").count()>0,
    resume:async ({page,context})=>{assert.equal(page,handle!.page);assert.equal(context,handle!.context);assert.equal(await page.locator("[data-listing]").getAttribute("data-area"),"100");continued=true;return "completed";},
    blocked:async()=>undefined,
  },async()=>undefined,{tickMs:100000});
  const session = await service.create(actor,{searchRunId:"20000000-0000-4000-8000-000000000001",source:"cian"});
  const harness = await viewerHarness(service,actor);
  const browser = await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1360,height:1100}});
    await page.goto(harness.origin+"/?id="+session.id);
    const screen=page.getByRole("application",{name:"Экран площадки"});
    await page.getByRole("button",{name:"Готово",exact:true}).waitFor();
    await page.waitForTimeout(800);
    await page.screenshot({path:"docs/screenshots/vkr/v31/captcha-stand-session.png",fullPage:true});
    await screen.click({position:{x:200,y:185}});
    await page.getByLabel("Текст для площадки",{exact:true}).fill("человек");
    await page.getByRole("button",{name:"Передать текст",exact:true}).click();
    await handle!.page.waitForFunction(()=>document.querySelector<HTMLInputElement>("input[name=proof]")?.value==="человек");
    await screen.click({position:{x:200,y:255}});
    await handle!.page.locator("[data-listing]").waitFor();
    await page.getByRole("button",{name:"Готово",exact:true}).click();
    await page.getByRole("status").filter({hasText:"Поиск продолжен"}).waitFor();
    assert.ok(continued);assert.ok(handle!.page.isClosed());assert.equal((await service.frame(actor,session.id)).frame,null);
    await page.screenshot({path:"docs/screenshots/vkr/v31/captcha-stand-completed.png",fullPage:true});
    await writeFile("docs/vkr/live-search-v31-captcha.json",JSON.stringify({mode:"REPLAY",utc:new Date().toISOString(),status:"PASS",detected:true,realReactViewer:true,continued,sameContext:true,closed:true,externalRequests:0},null,2));
    console.log("REPLAY_CAPTCHA_CYCLE_PASS");
  } finally {await browser.close();await service.shutdown();await harness.close();await stand.close();}
}
void main().catch(e=>{console.error(e instanceof Error?e.message:"STAND_FAILED");process.exitCode=1;});
