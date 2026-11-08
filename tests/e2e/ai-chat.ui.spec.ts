import {test,expect} from "@playwright/test";
import {login} from "./helpers";
test("chat panel: personal history, context, named links, rejection and confirmation preview",async({page})=>{
 if(process.env.E2E_CHAT_SESSION){
  await page.context().addCookies([{name:"crm_session",value:process.env.E2E_CHAT_SESSION,url:process.env.E2E_CHAT_BASE_URL??"http://localhost:3450",httpOnly:true,sameSite:"Lax"}]);await page.goto("/today");
 }else if(process.env.E2E_CHAT_DEMO==="true"){
  await page.goto("/login");await page.waitForFunction(()=>Object.keys(document.querySelector("form")??{}).some(k=>k.startsWith("__reactProps")));
  await page.getByLabel("Логин",{exact:true}).fill(process.env.SEED_MANAGER_LOGIN??"manager");await page.getByLabel("Пароль",{exact:true}).fill(process.env.SEED_MANAGER_PASSWORD!);await page.getByRole("button",{name:"Войти",exact:true}).click();await page.waitForURL("**/today");
 }else await login(page,"manager");
 const sessionId="00000000-0000-4000-8000-000000000081";const actionId="00000000-0000-4000-8000-000000000082";const clientId="00000000-0000-4000-8000-000000000083";
 const decisions:string[]=[];
 const chat={id:sessionId,title:"Проверка панели",contextType:"none",contextId:null,messages:[] as {id:string;role:string;content:string;toolArgs:unknown}[],actions:[] as {id:string;actionType:string;status:string;payload:unknown}[]};
 await page.route("**/api/v1/ai-chat/**",async route=>{
  const req=route.request();const path=new URL(req.url()).pathname;
  if(path.endsWith("/messages")){chat.messages=[{id:"m1",role:"assistant",content:`Клиент [[${clientId}]]`,toolArgs:[{id:clientId,label:"Демо-клиент",href:`/clients/${clientId}`}]}];chat.actions=[{id:actionId,actionType:"task",status:"proposed",payload:{clientId,title:"Уточнить условия",dueAt:"2026-11-06T04:00:00Z"}}];}
  if(path.endsWith(`/actions/${actionId}`)){const d=req.postDataJSON();expect(d.confirmed).toBe(true);decisions.push(d.decision);chat.actions[0]!.status=d.decision==="confirm"?"confirmed":"rejected";}
  await route.fulfill({json:path.endsWith("/sessions")&&req.method()==="GET"?{items:[chat]}:chat});
 });
 await page.getByRole("button",{name:"Открыть AI-помощника"}).click();const dialog=page.getByRole("dialog");await expect(dialog).toBeVisible();
 await expect(dialog.getByText("Сегодня. Новый диалог использует текущую страницу.",{exact:true})).toBeVisible();
 const quick=dialog.getByRole("button",{name:"С чего начать сегодня: просрочки и приоритеты?",exact:true});
 await quick.click();
 await expect(dialog.getByLabel("Сообщение",{exact:true})).toHaveValue("С чего начать сегодня: просрочки и приоритеты?");
 expect(decisions).toHaveLength(0);
 await expect(dialog.getByRole("link",{name:"Создать задачу",exact:true})).toHaveAttribute("href","/tasks/new");
 await dialog.getByLabel("Сообщение",{exact:true}).fill("подготовь задачу");await dialog.getByRole("button",{name:"Отправить",exact:true}).click();
 await expect(dialog.getByRole("link",{name:"Демо-клиент",exact:true})).toBeVisible();await expect(dialog.getByRole("button",{name:"Подтвердить",exact:true})).toBeVisible();expect(decisions).toHaveLength(0);
 await dialog.getByRole("button",{name:"Отклонить",exact:true}).click();await expect(dialog.getByText("Черновик отклонён. CRM не изменена.",{exact:true})).toBeVisible();expect(decisions).toEqual(["reject"]);
 await dialog.getByLabel("Сообщение",{exact:true}).fill("другая задача");await dialog.getByRole("button",{name:"Отправить",exact:true}).click();await dialog.getByRole("button",{name:"Подтвердить",exact:true}).click();await expect(dialog.getByText("Действие подтверждено и выполнено",{exact:true})).toBeVisible();expect(decisions).toEqual(["reject","confirm"]);
 await dialog.getByRole("button",{name:"Закрыть",exact:true}).click();await page.getByRole("button",{name:"Открыть AI-помощника"}).click();await expect(page.getByRole("dialog").getByRole("combobox",{name:"История диалогов"})).toContainText("Проверка панели");
 await page.setViewportSize({width:390,height:844});const box=await page.getByRole("dialog").boundingBox();expect(box?.width).toBeLessThanOrEqual(390);
});

test("a failed first POST reloads the persisted reply and draft without a second paid request",async({page})=>{
 if(process.env.E2E_CHAT_SESSION){await page.context().addCookies([{name:"crm_session",value:process.env.E2E_CHAT_SESSION,url:process.env.E2E_CHAT_BASE_URL??"http://localhost:3450",httpOnly:true,sameSite:"Lax"}]);await page.goto("/today");}else await login(page,"manager");
 const id="00000000-0000-4000-8000-000000000084",clientId="00000000-0000-4000-8000-000000000085";
 let posts=0,reads=0;
 const chat={id,title:"Первый ответ",contextType:"none",contextId:null,messages:[{id:"m1",role:"assistant",content:`Черновик для [[${clientId}]]`,toolArgs:[{id:clientId,label:"ООО «Надежда»",href:`/clients/${clientId}`}]}],actions:[{id:"action",actionType:"task",status:"proposed",payload:{title:"Уточнить условия"}}]};
 await page.route("**/api/v1/ai-chat/**",async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(path.endsWith("/messages")){posts++;await route.fulfill({status:422,json:{error:{code:"AI_RATE_LIMIT",message:"Достигнут лимит ИИ"}}});return;}
  if(path.endsWith(`/${id}`))reads++;
  await route.fulfill({json:path.endsWith("/sessions")&&request.method()==="GET"?{items:[]}:chat});
 });
 await page.getByRole("button",{name:"Открыть AI-помощника"}).click();const dialog=page.getByRole("dialog");
 await dialog.getByLabel("Сообщение",{exact:true}).fill("подготовь задачу");await dialog.getByRole("button",{name:"Отправить",exact:true}).click();
 await expect(dialog.getByRole("link",{name:"ООО «Надежда»",exact:true})).toBeVisible();
 await expect(dialog.getByRole("button",{name:"Подтвердить",exact:true})).toBeVisible();
 await expect(dialog.getByRole("alert")).toContainText("Достигнут лимит ИИ");
 expect(posts).toBe(1);expect(reads).toBe(1);await expect(dialog).not.toContainText("[PERSON]");
 if(process.env.E2E_CHAT_DEMO==="true")await dialog.screenshot({path:"docs/screenshots/vkr/v31/ai-chat-first-response-fake.png"});
});
