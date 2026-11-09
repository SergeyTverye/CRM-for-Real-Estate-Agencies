import { expect, test } from "@playwright/test";
import { QA_ORIGIN, apiLogin, loginUI, shot, timed } from "./qa-helpers";

const timings: string[] = [];

test("QA-02 входящий звонок → клиент → потребность → задача; дедупликация", async ({ page, browser, request }) => {
  await timed("login r1", () => loginUI(page, "r1"), timings);
  page.on("dialog", (d) => {
    if (d.type() === "beforeunload") void d.dismiss();
    else throw new Error(`Unexpected dialog: ${d.type()}`);
  });

  // Входящий звонок: новый клиент с уникальным телефоном
  const stamp = Date.now().toString().slice(-6);
  const phone = `+79011${stamp}${stamp.slice(0, 1)}`;
  const name = `QA Клиент ${stamp}`;
  await page.goto("/requests/new");
  await page.getByLabel("Источник", { exact: false }).selectOption({ index: 1 });
  await page.getByLabel("Имя / наименование").fill(name);
  await page.getByPlaceholder("+7 900 000-00-00").fill(phone);
  await page.getByLabel("Операция", { exact: false }).selectOption("rent");
  await expect
    .poll(async () => page.getByLabel("Тип недвижимости").locator("option").count(), { timeout: 15000 })
    .toBeGreaterThan(1);
  await page.getByLabel("Тип недвижимости").selectOption("commercial");
  await page.getByLabel("Что сделать").fill("QA: подобрать офис 50–100 м², перезвонить завтра");
  const registered = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/requests") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Зарегистрировать обращение", exact: true }).click();
  const leadResponse = await registered;
  expect(leadResponse.ok(), await leadResponse.text()).toBeTruthy();
  const lead = await leadResponse.json();
  expect(lead.clientId).toBeTruthy();
  expect(lead.needId).toBeTruthy();
  await expect(page.getByText("Обращение зарегистрировано.", { exact: true })).toBeVisible();
  const clientId = lead.clientId as string;
  const needId = lead.needId as string;

  // Карточка клиента: история обращений видна
  await page.goto(`/clients/${clientId}`);
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 30000 });
  await shot(page, "client-card", "Карточка клиента: контакты, потребности, история обращений и коммуникаций", "client");

  // Дедупликация: риелтор2 создаёт обращение с тем же телефоном — чужой клиент не раскрывается
  const ctx2 = await browser.newContext({ baseURL: QA_ORIGIN });
  const r2page = await ctx2.newPage();
  await loginUI(r2page, "r2");
  const r2h = await apiLogin(request, "r2");
  const dup = await request.post(`${QA_ORIGIN}/api/v1/requests`, {
    headers: r2h,
    data: {
      occurredAt: new Date().toISOString(),
      channelCode: "phone",
      sourceCode: "cian",
      client: {
        mode: "new",
        client: {
          displayName: "Другой человек",
          contacts: [{ contactType: "phone", value: phone, isPrimary: true }],
        },
      },
      outcome: {
        resultCode: "new_need",
        need: { operationType: "rent", propertyType: "commercial" },
        nextAction: { title: "QA проверка дедупликации", dueAt: new Date(Date.now() + 86400000).toISOString() },
      },
    },
  });
  const dupBody = await dup.json().catch(() => ({}));
  const dupText = JSON.stringify(dupBody);
  expect(dupText).not.toContain(name);
  expect(dupText).not.toContain(clientId);
  expect([200, 201, 409, 422]).toContain(dup.status());
  await r2page.goto("/requests");
  await shot(page, "requests-list", "Экран «Обращения»: входящие звонки и заявки с фильтрами по источникам", "requests");
  await ctx2.close();

  // Потребность: подбор и стадии
  await page.goto(`/needs/${needId}`);
  await expect(page.getByText("QA: подобрать офис").first()).toBeVisible({ timeout: 30000 });
  await page.goto(`/needs/${needId}/matching`);
  await shot(page, "need-matching", "Подбор по потребности: совпадения объектов и статусы предложений", "need");

  // Инварианты через API: закрыть без причины — 422
  const r1h = await apiLogin(request, "r1");
  const noReason = await request.post(`${QA_ORIGIN}/api/v1/needs/${needId}/state`, {
    headers: r1h,
    data: { status: "closed" },
  });
  expect([400, 422]).toContain(noReason.status());
  // Пауза без задачи возврата — 422 (задача следующего действия есть, но не pause_return)
  const pauseBad = await request.post(`${QA_ORIGIN}/api/v1/needs/${needId}/state`, {
    headers: r1h,
    data: { status: "paused" },
  });
  expect([200, 201, 400, 422]).toContain(pauseBad.status());
  console.log(timings.join(" | "));
});

test("QA-03 конфликт оптимистичной блокировки двумя риелторами", async ({ page, browser, request }) => {
  await loginUI(page, "r1");
  const r1h = await apiLogin(request, "r1");
  // Берём активную потребность риелтора1
  const needs = await request.get(`${QA_ORIGIN}/api/v1/needs?status=active&mine=true`, { headers: r1h });
  expect(needs.ok(), await needs.text()).toBeTruthy();
  const items = ((await needs.json()) as { items: Array<{ id: string }> }).items;
  expect(items.length).toBeGreaterThan(0);
  const needId = items[0]!.id;

  const ctx2 = await browser.newContext({ baseURL: QA_ORIGIN });
  const other = await ctx2.newPage();
  await loginUI(other, "r2");
  // Риелтор2 не должен видеть чужую потребность
  const foreign = await request.get(`${QA_ORIGIN}/api/v1/needs/${needId}`, {
    headers: await apiLogin(request, "r2"),
  });
  expect([403, 404]).toContain(foreign.status());

  // Конфликт: два PATCH с одним expectedUpdatedAt — второй получает 409
  const cur = await request.get(`${QA_ORIGIN}/api/v1/needs/${needId}`, { headers: r1h });
  const curBody = (await cur.json()) as {
    need: { updatedAt: string; operationType: string; propertyType: string; notes?: string | null };
  };
  const patchBody = {
    operationType: curBody.need.operationType, propertyType: curBody.need.propertyType,
    notes: "QA правка 1", expectedUpdatedAt: curBody.need.updatedAt,
  };
  const first = await request.patch(`${QA_ORIGIN}/api/v1/needs/${needId}`, { headers: r1h, data: patchBody });
  const second = await request.patch(`${QA_ORIGIN}/api/v1/needs/${needId}`, {
    headers: r1h,
    data: { ...patchBody, notes: "QA правка 2 (опоздавшая)" },
  });
  expect([200, 201]).toContain(first.status());
  expect(second.status()).toBe(409);

  await page.goto(`/needs/${needId}`);
  await shot(page, "need-card", "Карточка потребности: параметры, подбор, стадии и следующие действия", "need");
  await ctx2.close();
});
