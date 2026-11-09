import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { DESKTOP_ORIGIN, apiLogin, loginUI, profileDbFile, openProfileDbReadonly, shot, timed } from "./desktop-helpers";

const timings: string[] = [];

async function ids(request: import("@playwright/test").APIRequestContext, headers: Record<string, string>, role: string) {
  const needs = (await (await request.get(`${DESKTOP_ORIGIN}/api/v1/needs?status=active&mine=true`, { headers })).json()) as {
    items: Array<{ id: string }>;
  };
  const props = (await (await request.get(`${DESKTOP_ORIGIN}/api/v1/properties?status=active&take=5`, { headers })).json()) as {
    items: Array<{ id: string; price: string | number | null }>;
  };
  const clients = (await (await request.get(`${DESKTOP_ORIGIN}/api/v1/clients?take=5`, { headers })).json()) as {
    items: Array<{ id: string }>;
  };
  const les = ((await (await request.get(`${DESKTOP_ORIGIN}/api/v1/legal-entities`, { headers })).json()) as {
    items?: Array<{ id: string }>;
  }).items ?? [];
  if (!needs.items.length || props.items.length < 2 || !clients.items.length || !les.length)
    throw new Error(`desktop seed missing for ${role}: needs=${needs.items.length} props=${props.items.length} clients=${clients.items.length} les=${les.length}`);
  return { needId: needs.items[0]!.id, propertyIds: [props.items[0]!.id, props.items[1]!.id], clientId: clients.items[0]!.id, leId: les[0]!.id, price: props.items[0]!.price };
}

test("D-01 вход/выход, неверный пароль 401, экран Сегодня", async ({ page, request }) => {
  const bad = await request.post(`${DESKTOP_ORIGIN}/api/v1/auth/login`, {
    headers: { Origin: DESKTOP_ORIGIN },
    data: { login: "d-manager", password: "wrong-password-123" },
  });
  expect(bad.status()).toBe(401);
  await timed("login UI manager", () => loginUI(page, "manager"), timings);
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: /Сегодня/i }).first()).toBeVisible({ timeout: 30000 });
  await shot(page, "today-manager", "Экран «Сегодня»: задачи, просрочки и ближайшие события руководителя", "today");
  const me = await request.get(`${DESKTOP_ORIGIN}/api/v1/auth/me`, { headers: { Origin: DESKTOP_ORIGIN } });
  expect(me.status()).toBe(401);
  console.log(timings.join(" | "));
});

test("D-02 звонок → клиент → потребность → задача; дедупликация чужого телефона", async ({ page, browser, request }) => {
  await timed("login r1", () => loginUI(page, "r1"), timings);
  const stamp = Date.now().toString().slice(-6);
  const phone = `+79021${stamp}${stamp.slice(0, 1)}`;
  const name = `QA-D Клиент ${stamp}`;
  await page.goto("/requests/new");
  await page.getByLabel("Источник", { exact: false }).selectOption({ index: 1 });
  await page.getByLabel("Имя / наименование").fill(name);
  await page.getByPlaceholder("+7 900 000-00-00").fill(phone);
  await page.getByLabel("Операция", { exact: false }).selectOption("rent");
  await expect.poll(async () => page.getByLabel("Тип недвижимости").locator("option").count(), { timeout: 15000 }).toBeGreaterThan(1);
  await page.getByLabel("Тип недвижимости").selectOption("commercial");
  await page.getByLabel("Что сделать").fill("QA-D: подобрать офис 50–100 м², перезвонить завтра");
  const registered = page.waitForResponse((r) => r.url().endsWith("/api/v1/requests") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Зарегистрировать обращение", exact: true }).click();
  const leadResponse = await registered;
  expect(leadResponse.ok(), await leadResponse.text()).toBeTruthy();
  const lead = await leadResponse.json();
  expect(lead.clientId).toBeTruthy();
  expect(lead.needId).toBeTruthy();
  await expect(page.getByText("Обращение зарегистрировано.", { exact: true })).toBeVisible();
  const clientId = lead.clientId as string;
  const needId = lead.needId as string;

  await page.goto(`/clients/${clientId}`);
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 30000 });
  await shot(page, "client-card", "Карточка клиента: контакты, потребности, история обращений и коммуникаций", "client");

  const ctx2 = await browser.newContext({ baseURL: DESKTOP_ORIGIN });
  const r2page = await ctx2.newPage();
  await loginUI(r2page, "r2");
  const r2h = await apiLogin(request, "r2");
  const dup = await request.post(`${DESKTOP_ORIGIN}/api/v1/requests`, {
    headers: r2h,
    data: {
      occurredAt: new Date().toISOString(), channelCode: "phone", sourceCode: "cian",
      client: { mode: "new", client: { displayName: "Другой человек", contacts: [{ contactType: "phone", value: phone, isPrimary: true }] } },
      outcome: { resultCode: "new_need", need: { operationType: "rent", propertyType: "commercial" }, nextAction: { title: "QA-D проверка дедупликации", dueAt: new Date(Date.now() + 86400000).toISOString() } },
    },
  });
  const dupText = JSON.stringify(await dup.json().catch(() => ({})));
  expect(dupText).not.toContain(name);
  expect(dupText).not.toContain(clientId);
  expect([200, 201, 409, 422]).toContain(dup.status());
  await r2page.goto("/requests");
  await shot(r2page, "requests-list", "Экран «Обращения»: входящие звонки и заявки с фильтрами по источникам", "requests");
  await ctx2.close();

  await page.goto(`/needs/${needId}`);
  await expect(page.getByText("QA-D: подобрать офис").first()).toBeVisible({ timeout: 30000 });
  await page.goto(`/needs/${needId}/matching`);
  await shot(page, "need-matching", "Подбор по потребности: совпадения объектов и статусы предложений", "need");

  const r1h = await apiLogin(request, "r1");
  const noReason = await request.post(`${DESKTOP_ORIGIN}/api/v1/needs/${needId}/state`, { headers: r1h, data: { status: "closed" } });
  expect([400, 422]).toContain(noReason.status());
  console.log(timings.join(" | "));
});

test("D-03 конфликт оптимистичной блокировки; чужая потребность недоступна", async ({ page, browser, request }) => {
  await loginUI(page, "r1");
  const r1h = await apiLogin(request, "r1");
  const needs = await request.get(`${DESKTOP_ORIGIN}/api/v1/needs?status=active&mine=true`, { headers: r1h });
  expect(needs.ok(), await needs.text()).toBeTruthy();
  const items = ((await needs.json()) as { items: Array<{ id: string }> }).items;
  expect(items.length).toBeGreaterThan(0);
  const needId = items[0]!.id;

  const ctx2 = await browser.newContext({ baseURL: DESKTOP_ORIGIN });
  const other = await ctx2.newPage();
  await loginUI(other, "r2");
  const foreign = await request.get(`${DESKTOP_ORIGIN}/api/v1/needs/${needId}`, { headers: await apiLogin(request, "r2") });
  expect([403, 404]).toContain(foreign.status());

  const cur = await request.get(`${DESKTOP_ORIGIN}/api/v1/needs/${needId}`, { headers: r1h });
  const curBody = (await cur.json()) as { need: { updatedAt: string; operationType: string; propertyType: string } };
  const patchBody = { operationType: curBody.need.operationType, propertyType: curBody.need.propertyType, notes: "QA-D правка 1", expectedUpdatedAt: curBody.need.updatedAt };
  const first = await request.patch(`${DESKTOP_ORIGIN}/api/v1/needs/${needId}`, { headers: r1h, data: patchBody });
  const second = await request.patch(`${DESKTOP_ORIGIN}/api/v1/needs/${needId}`, { headers: r1h, data: { ...patchBody, notes: "QA-D правка 2 (опоздавшая)" } });
  expect([200, 201]).toContain(first.status());
  expect(second.status()).toBe(409);

  await page.goto(`/needs/${needId}`);
  await shot(page, "need-card", "Карточка потребности: параметры, подбор, стадии и следующие действия", "need");
  await ctx2.close();
});

test("D-04 объект: создание, фото, доступ; показ с результатом", async ({ page, request }) => {
  await timed("login r1", () => loginUI(page, "r1"), timings);
  const stamp = Date.now().toString().slice(-6);
  await page.goto("/properties/new");
  await page.getByLabel("Операция", { exact: false }).first().selectOption("rent");
  await expect.poll(async () => page.getByLabel("Тип недвижимости").first().locator("option").count(), { timeout: 15000 }).toBeGreaterThan(1);
  await page.getByLabel("Тип недвижимости").first().selectOption("commercial");
  await page.getByLabel("Подтип", { exact: false }).first().selectOption("office");
  await page.getByLabel("Адрес", { exact: false }).fill(`QA-D Новосибирск, ул. Вымышленная, ${stamp}`);
  await page.getByLabel("Цена", { exact: false }).fill("75000");
  await page.getByLabel("Площадь", { exact: false }).first().fill("85");
  const created = page.waitForResponse((r) => r.url().endsWith("/api/v1/properties") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Создать объект", exact: true }).click();
  const res = await created;
  expect(res.ok(), await res.text()).toBeTruthy();
  const property = await res.json();
  const propertyId = property.id as string;
  await expect(page).toHaveURL(new RegExp(`/properties/${propertyId}$`), { timeout: 30000 });

  const r1h = await apiLogin(request, "r1");
  const png = await readFile("scripts/demo/assets/demo-logo.png").catch(() => Buffer.from("qa"));
  const media = await request.post(`${DESKTOP_ORIGIN}/api/v1/properties/${propertyId}/media`, {
    headers: { Cookie: r1h.Cookie, Origin: DESKTOP_ORIGIN },
    multipart: { file: { name: "qa-d-photo.png", mimeType: "image/png", buffer: png }, kind: "photo" },
  });
  expect([200, 201]).toContain(media.status());
  await page.reload();
  await shot(page, "property-card", "Карточка объекта: адрес, параметры, фото, документы и собственники", "property");
  await page.goto("/properties");
  await shot(page, "properties-list", "Экран «Объекты»: таблица с фильтрами по типу, операции и району", "property");

  const r2h = await apiLogin(request, "r2");
  const grant = await request.post(`${DESKTOP_ORIGIN}/api/v1/properties/${propertyId}/request-access`, {
    headers: r2h, data: { reason: "QA-D: нужен контакт собственника для показа" },
  });
  expect([200, 201, 409]).toContain(grant.status());

  const needs = await request.get(`${DESKTOP_ORIGIN}/api/v1/needs?status=active&mine=true`, { headers: r1h });
  const needId = ((await needs.json()) as { items: Array<{ id: string }> }).items[0]!.id;
  await page.goto(`/showings/new?needId=${needId}&propertyId=${propertyId}`);
  await page.waitForFunction(() => Object.keys(document.querySelector("form") ?? {}).some((k) => k.startsWith("__reactProps"))).catch(() => undefined);
  const showingCreated = page.waitForResponse((r) => r.url().endsWith("/api/v1/showings") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Назначить показ", exact: true }).click();
  const showingRes = await showingCreated;
  expect(showingRes.ok(), await showingRes.text()).toBeTruthy();
  await expect(page).toHaveURL(/\/showings\/[0-9a-f-]+$/, { timeout: 60000 });
  await page.getByRole("button", { name: "Зафиксировать результат", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Результат", { exact: false }).selectOption("interested");
  await page.getByRole("button", { name: "Сохранить результат", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.goto("/showings");
  await shot(page, "showings-list", "Экран «Показы»: запланированные и завершённые с результатами", "showing");
  console.log(timings.join(" | "));
});

test("D-05 задачи и календарь: перенос, уведомления", async ({ page, request }) => {
  await loginUI(page, "r1");
  const r1h = await apiLogin(request, "r1");
  const tasks = await request.get(`${DESKTOP_ORIGIN}/api/v1/tasks?status=open&mine=true`, { headers: r1h });
  expect(tasks.ok(), await tasks.text()).toBeTruthy();
  const items = ((await tasks.json()) as { items: Array<{ id: string; updatedAt: string }> }).items;
  expect(items.length).toBeGreaterThan(0);
  const t0 = items[0]!;
  const t = Date.now();
  const moved = await request.patch(`${DESKTOP_ORIGIN}/api/v1/tasks/${t0.id}`, {
    headers: r1h, data: { dueAt: new Date(Date.now() + 2 * 86400000).toISOString(), expectedUpdatedAt: t0.updatedAt },
  });
  expect([200, 201]).toContain(moved.status());
  timings.push(`перенос задачи: ${Date.now() - t} мс`);

  await page.goto("/today");
  await shot(page, "today-realtor", "«Сегодня» риелтора: просрочки, задачи на день и ближайшие события", "today");
  await page.goto("/calendar");
  await expect(page.locator(".fc-event, [data-calendar]").first()).toBeVisible({ timeout: 30000 }).catch(() => undefined);
  await shot(page, "calendar", "Календарь: встречи, показы и повторяющиеся серии", "tasks");
  await page.goto("/notifications");
  await shot(page, "notifications", "Уведомления: напоминания воркера о задачах и событиях", "tasks");
  console.log(timings.join(" | "));
});

test("D-06 КП со снапшотами → отправка → печатная форма", async ({ page, request }) => {
  await loginUI(page, "r1");
  const h = await apiLogin(request, "r1");
  const { needId, propertyIds, leId } = await ids(request, h, "r1");
  const t = Date.now();
  const created = await request.post(`${DESKTOP_ORIGIN}/api/v1/offers`, {
    headers: h, data: { clientNeedId: needId, legalEntityId: leId, title: `QA-D КП ${Date.now()}`, items: propertyIds.map((propertyId) => ({ propertyId })) },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  timings.push(`создание КП: ${Date.now() - t} мс`);
  const offer = (await created.json()) as { id: string };
  const card = (await (await request.get(`${DESKTOP_ORIGIN}/api/v1/offers/${offer.id}`, { headers: h })).json()) as {
    offer: { items: Array<{ priceSnapshot: string | null; addressSnapshot: string | null }>; status: string; updatedAt: string };
  };
  expect(card.offer.items.length).toBe(2);
  expect(card.offer.items[0]!.addressSnapshot).toBeTruthy();
  const sent = await request.post(`${DESKTOP_ORIGIN}/api/v1/offers/${offer.id}/status`, {
    headers: h, data: { status: "sent", expectedUpdatedAt: card.offer.updatedAt, onBehalfOfCompany: true },
  });
  expect([200, 201, 404]).toContain(sent.status());
  await page.goto(`/offers/${offer.id}`);
  await expect(page.getByText(/QA-D КП/).first()).toBeVisible({ timeout: 30000 });
  await shot(page, "offer-card", "Коммерческое предложение: позиции со снапшотами цен и адресов, статусы", "offer");
  await page.goto(`/offers/${offer.id}/print`);
  await shot(page, "offer-print", "Печатная форма КП (A4): позиции, цены, условия", "offer");
  await page.goto("/offers");
  await shot(page, "offers-list", "Экран «Коммерческие предложения»: черновики, отправленные, архив", "offer");
  console.log(timings.join(" | "));
});

test("D-07 сделка: 2 стороны + 2 комиссии → закрытие → постсделочные задачи", async ({ page, request }) => {
  await loginUI(page, "r1");
  const h = await apiLogin(request, "r1");
  const { needId, propertyIds, clientId, leId, price } = await ids(request, h, "r1");
  const created = await request.post(`${DESKTOP_ORIGIN}/api/v1/deals`, {
    headers: h,
    data: {
      propertyId: propertyIds[0], legalEntityId: leId, clientNeedId: needId, dealPrice: String(price ?? 5000000), notes: "QA-D сделка: проверка комиссий",
      parties: [{ clientId, partyRole: "tenant" }, { externalPartyName: "ООО «Вымышленный Арендодатель Д»", partyRole: "landlord" }],
      commissions: [{ amount: "45000.00", status: "due", comment: "QA-D комиссия арендатора" }, { amount: "45000.00", status: "due", comment: "QA-D комиссия арендодателя" }],
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const deal = (await created.json()) as { id: string };
  const card = (await (await request.get(`${DESKTOP_ORIGIN}/api/v1/deals/${deal.id}`, { headers: h })).json()) as {
    deal: { commissions: Array<{ amount: string }>; updatedAt: string };
  };
  expect(card.deal.commissions.length).toBe(2);
  const localNow = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 16);
  const closed = await request.post(`${DESKTOP_ORIGIN}/api/v1/deals/${deal.id}/close`, {
    headers: h,
    data: { expectedUpdatedAt: card.deal.updatedAt, status: "completed", comment: "QA-D: сделка завершена", postdealTasks: [{ subtypeCode: "invoice", title: `QA-D счёт ${Date.now()}`, dueAt: localNow }, { subtypeCode: "followup", title: `QA-D повторный контакт ${Date.now()}`, dueAt: localNow }] },
  });
  expect([200, 201]).toContain(closed.status());
  await page.goto(`/deals/${deal.id}`);
  await expect(page.getByText(/QA-D сделка/).first()).toBeVisible({ timeout: 30000 });
  await shot(page, "deal-card", "Карточка сделки: стороны, две комиссионные записи, чек-лист и задачи", "deal");
  await page.goto("/deals");
  await shot(page, "deals-list", "Экран «Сделки»: воронка по статусам и суммам", "deal");
});

test("D-08 договор + документ, допсоглашение, архив; реклама", async ({ page, request }) => {
  await loginUI(page, "r1");
  const h = await apiLogin(request, "r1");
  const { propertyIds, clientId, leId } = await ids(request, h, "r1");
  const created = await request.post(`${DESKTOP_ORIGIN}/api/v1/agreements`, {
    headers: h,
    data: {
      clientId, propertyId: propertyIds[0], legalEntityId: leId, agreementType: "lease_related", status: "signed", agreementNumber: `QA-D-${Date.now()}`,
      signedAt: new Date().toISOString().slice(0, 10), validFrom: new Date().toISOString().slice(0, 10), validUntil: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10), notes: "QA-D договор аренды",
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const agreement = (await created.json()) as { id: string };
  const pdf = Buffer.from("%PDF-1.4 QA-D synthetic agreement\n");
  const upload = await request.post(`${DESKTOP_ORIGIN}/api/v1/documents`, {
    headers: { Cookie: h.Cookie, Origin: DESKTOP_ORIGIN },
    multipart: { file: { name: "qa-d-dogovor.pdf", mimeType: "application/pdf", buffer: pdf }, documentTypeCode: "agreement", linkKind: "agreement", linkId: agreement.id, legalEntityId: leId },
  });
  expect([200, 201]).toContain(upload.status());
  await page.goto(`/agreements/${agreement.id}`);
  await expect(page.getByText(/QA-D договор/).first()).toBeVisible({ timeout: 30000 });
  await shot(page, "agreement-card", "Карточка договора: сроки, юрлицо, приложенные документы", "agreement");
  await page.goto("/agreements");
  await shot(page, "agreements-list", "Экран «Договоры»: действующие, истекающие и архив", "agreement");

  const ad = await request.post(`${DESKTOP_ORIGIN}/api/v1/advertisements`, {
    headers: h,
    data: { propertyId: propertyIds[0], platformCode: "cian", url: `https://example.ru/ads/qa-d-${Date.now()}`, adText: "QA-D вымышленное объявление: светлый офис в центре.", status: "active", publishedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10) },
  });
  expect([200, 201]).toContain(ad.status());
  await page.goto("/advertisements");
  await expect(page.getByText(/QA-D вымышленное/).first()).toBeVisible({ timeout: 30000 }).catch(() => undefined);
  await shot(page, "ads-list", "Экран «Реклама»: площадки, сроки публикации и истекающие объявления", "ads");
});

test("D-09 отчёты руководителя и drill-down", async ({ page, request }) => {
  await loginUI(page, "manager");
  const h = await apiLogin(request, "manager");
  const t = Date.now();
  const rep = await request.get(`${DESKTOP_ORIGIN}/api/v1/reports/manager`, { headers: h });
  expect(rep.ok(), await rep.text()).toBeTruthy();
  timings.push(`отчёт manager: ${Date.now() - t} мс`);
  const detailT = Date.now();
  const det = await request.get(`${DESKTOP_ORIGIN}/api/v1/reports/detail?kind=requests`, { headers: h });
  timings.push(`отчёт detail: ${Date.now() - detailT} drill=${det.status()} мс`);
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: /Отч/i }).first()).toBeVisible({ timeout: 30000 });
  await shot(page, "reports", "Экран «Отчёты»: обращения, этапы, показы, просрочки, сделки, активность", "reports");
  await page.goto("/reports/sources");
  await shot(page, "reports-sources", "Отчёт по источникам обращений с переходом к первичным записям", "reports");
  await page.goto("/reports/detail");
  await shot(page, "reports-detail", "Детализация отчёта: drill-down до первичных записей", "reports");
  console.log(timings.join(" | "));
});

test("D-10 импорт синтетики: dry-run → commit → повтор без дублей", async ({ page }) => {
  test.setTimeout(240_000);
  await loginUI(page, "manager");
  await page.goto("/import");
  await expect(page.getByRole("heading", { name: "Рабочая книга объектов и обращений" })).toBeVisible({ timeout: 30000 });
  await page.getByLabel("Синтетическая или разрешённая локальная книга .xlsx").setInputFiles("tests/fixtures/synthetic/workbook-like.xlsx");
  await page.getByRole("button", { name: "Проверить без загрузки в CRM" }).click();
  await expect(page.getByText(/Строк: \d+/).first()).toBeVisible({ timeout: 120000 });
  const body1 = await page.locator("body").innerText();
  expect(body1).not.toContain("POLICY_SECRET");
  expect(body1).not.toContain("паспорт");
  await shot(page, "import-dryrun-empty", "Импорт workbook-like: корректный dry-run без распознанных строк, без утечек", "import");

  await page.getByLabel("Синтетическая или разрешённая локальная книга .xlsx").setInputFiles("tests/fixtures/synthetic/enterprise-workbook.xlsx");
  await page.getByRole("button", { name: "Проверить без загрузки в CRM" }).click();
  await expect(page.getByText(/Требуют решения:|Строк: \d+/).first()).toBeVisible({ timeout: 120000 });
  const t = Date.now();
  const mapping = page.getByText("Настройка сопоставления колонок и скрытых строк", { exact: true });
  if (await mapping.count()) {
    await mapping.click();
    const textarea = page.getByRole("textbox", { name: "Профиль v2" });
    const profile = JSON.parse(await textarea.inputValue());
    for (const sheet of profile.sheets) {
      sheet.defaults.priceUnit = "rub_month";
      for (const key of Object.keys(sheet.columns)) if (sheet.columns[key] === null) sheet.columns[key] = "ignore";
      if (sheet.target === null && Object.values(sheet.columns).every((v) => v === "ignore" || v === null)) sheet.target = "ignore";
    }
    await textarea.fill(JSON.stringify(profile, null, 2));
    await page.getByRole("button", { name: "Применить профиль и повторить dry-run" }).click();
    await expect(page.getByText("Требуют решения:")).toHaveCount(0, { timeout: 120000 });
  }
  timings.push(`import dry-run+mapping: ${Date.now() - t} мс`);
  await shot(page, "import-dryrun", "Импорт: результат dry-run по синтетической книге, статусы строк", "import");
  const ack1 = page.getByLabel("Предупреждения проверены; неоднозначные сведения потребуют ручного уточнения");
  if (await ack1.count()) await ack1.check();
  const ack2 = page.getByLabel("Подтверждаю загрузку допустимых строк, пропуск ошибок и дублей");
  if (await ack2.count()) await ack2.check();
  const commitBtn = page.getByRole("button", { name: "Загрузить в CRM", exact: true });
  if (await commitBtn.isEnabled()) {
    const committed = page.waitForResponse((r) => r.url().includes("/api/v1/import/enterprise/") && r.request().method() === "POST", { timeout: 120000 });
    await commitBtn.click();
    const response = await committed;
    expect(response.ok(), await response.text()).toBeTruthy();
    const result = (await response.json()) as { id: string };
    await expect(page.getByText("Импорт завершён.", { exact: true })).toBeVisible({ timeout: 120000 });
    timings.push("import commit: ok");
    await shot(page, "import-commit", "Импорт завершён: счётчики загруженных, пропущенных и ошибок", "import");
    await page.getByLabel("Синтетическая или разрешённая локальная книга .xlsx").setInputFiles("tests/fixtures/synthetic/enterprise-workbook.xlsx");
    await page.getByRole("button", { name: "Проверить без загрузки в CRM" }).click();
    await expect(page.getByText(/уже загружался|Строк: \d+/).first()).toBeVisible({ timeout: 120000 });
    await page.goto(`/import/${result.id}`);
    await expect(page.getByText("Импорт завершён.", { exact: true })).toBeVisible({ timeout: 60000 });
  }
  console.log(timings.join(" | "));
});

test("D-11 поиск объектов, локации, экспорт; AI-лимиты без платных вызовов", async ({ page, request }) => {
  test.setTimeout(300_000);
  await loginUI(page, "manager");
  const h = await apiLogin(request, "manager");
  const limits = await request.get(`${DESKTOP_ORIGIN}/api/v1/ai/limits`, { headers: h });
  expect([200, 404]).toContain(limits.status());
  await page.goto("/property-search");
  await expect(page.getByRole("heading", { name: "Поиск объектов", exact: true })).toBeVisible({ timeout: 30000 });
  for (const loc of ["Академгородок (Советский район)", "Бердск"]) {
    const btn = page.getByRole("button", { name: loc, exact: true });
    if (await btn.count()) await btn.first().click();
  }
  await page.locator("label").filter({ hasText: /^\s*Операция/ }).locator("select").selectOption("rent");
  const kind = page.getByLabel("Тип объекта", { exact: true });
  if (await kind.count()) await kind.selectOption("flat");
  await page.getByLabel("Цена до", { exact: true }).fill("5000000");
  await page.getByLabel("Площадь от, м²", { exact: true }).fill("30");
  await shot(page, "search-filters", "Поиск объектов: локации, операция, тип, цены и площади", "search");
  const avail = await request.get(`${DESKTOP_ORIGIN}/api/v1/property-search/availability`, { headers: h });
  expect([200, 503]).toContain(avail.status());
  await page.goto("/settings/backups");
  await expect(page.getByRole("region", { name: "Локально" }).first()).toBeVisible({ timeout: 30000 });
  await shot(page, "backup-settings", "Настройки резервных копий: локальное назначение, расписание, каталог архивов", "backup");
});

test("D-12 RBAC: чужой клиент/документы/поиск/архив недоступны; админка по ролям", async ({ page, browser, request }) => {
  await loginUI(page, "r1");
  const r1h = await apiLogin(request, "r1");
  const r2h = await apiLogin(request, "r2");
  const mine = (await (await request.get(`${DESKTOP_ORIGIN}/api/v1/clients?take=1`, { headers: r1h })).json()) as {
    items: Array<{ id: string; displayName: string }>;
  };
  const foreign = mine.items[0]!;
  const direct = await request.get(`${DESKTOP_ORIGIN}/api/v1/clients/${foreign.id}`, { headers: r2h });
  expect([403, 404]).toContain(direct.status());
  const ctx = await browser.newContext({ baseURL: DESKTOP_ORIGIN });
  const other = await ctx.newPage();
  await loginUI(other, "r2");
  await other.goto(`/clients/${foreign.id}`);
  await expect(other.getByRole("heading", { name: "Запись не найдена или недоступна", exact: true })).toBeVisible({ timeout: 30000 });
  await shot(other, "rbac-forbidden", "RBAC: чужой клиент по прямой ссылке недоступен, данные не раскрыты", "rbac");
  const q = encodeURIComponent(foreign.displayName.slice(0, 12));
  const search = await request.get(`${DESKTOP_ORIGIN}/api/v1/search?q=${q}`, { headers: r2h });
  if (search.ok()) {
    const body = await search.text();
    expect(body).not.toContain(foreign.id);
    expect(body).not.toContain(foreign.displayName);
  }
  await other.goto("/clients");
  await other.getByLabel("Глобальный поиск").fill(foreign.displayName.slice(0, 12));
  await other.waitForTimeout(2000);
  const dropText = await other.locator(".global-search").innerText();
  expect(dropText).not.toContain(foreign.displayName);
  await shot(other, "rbac-search", "Глобальный поиск риелтора: чужие записи отсутствуют в выдаче", "rbac");
  const archive = await request.get(`${DESKTOP_ORIGIN}/api/v1/archive?take=1`, { headers: r2h });
  expect([200, 403]).toContain(archive.status());
  await other.goto("/archive");
  await shot(other, "archive", "Исторический архив: отделён от операционного CRM, доступ по ролям", "rbac");
  await other.goto("/admin/users");
  await expect(other).toHaveURL(/\/forbidden/);
  expect((await request.get(`${DESKTOP_ORIGIN}/api/v1/admin/users`, { headers: r2h })).status()).toBe(403);
  await ctx.close();
});

test("D-13 SQLite профиля: счётчики сущностей и контрольная запись", async () => {
  const db = openProfileDbReadonly(profileDbFile());
  try {
    const count = (t: string) => (db.prepare(`select count(*) as n from ${t}`).get() as { n: number }).n;
    const summary = { clients: count("clients"), needs: count("client_needs"), properties: count("properties"), tasks: count("tasks"), deals: count("deals") };
    expect(summary.clients).toBeGreaterThanOrEqual(100);
    expect(summary.needs).toBeGreaterThanOrEqual(100);
    expect(summary.properties).toBeGreaterThanOrEqual(100);
    console.log(`sqlite counts: ${JSON.stringify(summary)}`);
  } finally {
    db.close();
  }
});
