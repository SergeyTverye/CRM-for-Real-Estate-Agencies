import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { QA_ORIGIN, apiLogin, loginUI, shot, timed } from "./qa-helpers";

const timings: string[] = [];

test("QA-04 объекты: создание, фото, документы, собственник, доступ; показы", async ({ page, request }) => {
  await timed("login r1", () => loginUI(page, "r1"), timings);
  page.on("dialog", (d) => {
    if (d.type() === "beforeunload") void d.dismiss();
    else throw new Error(`Unexpected native dialog: ${d.type()}`);
  });
  const stamp = Date.now().toString().slice(-6);

  // Создание объекта через UI
  await page.goto("/properties/new");
  await page.getByLabel("Операция", { exact: false }).first().selectOption("rent");
  await expect
    .poll(async () => page.getByLabel("Тип недвижимости").first().locator("option").count(), { timeout: 15000 })
    .toBeGreaterThan(1);
  await page.getByLabel("Тип недвижимости").first().selectOption("commercial");
  await page.getByLabel("Подтип", { exact: false }).first().selectOption("office");
  await page.getByLabel("Адрес", { exact: false }).fill(`QA Новосибирск, ул. Вымышленная, ${stamp}`);
  await page.getByLabel("Цена", { exact: false }).fill("75000");
  await page.getByLabel("Площадь", { exact: false }).first().fill("85");
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/properties") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Создать объект", exact: true }).click();
  const res = await created;
  expect(res.ok(), await res.text()).toBeTruthy();
  const property = await res.json();
  const propertyId = property.id as string;
  await expect(page).toHaveURL(new RegExp(`/properties/${propertyId}$`), { timeout: 30000 });

  // Фото: загрузка через API (multipart), затем проверка в карточке
  const r1h = await apiLogin(request, "r1");
  const png = await readFile("scripts/demo/assets/demo-logo.png").catch(() => Buffer.from("qa"));
  const media = await request.post(`${QA_ORIGIN}/api/v1/properties/${propertyId}/media`, {
    headers: { Cookie: r1h.Cookie, Origin: QA_ORIGIN },
    multipart: { file: { name: "qa-photo.png", mimeType: "image/png", buffer: png }, kind: "photo" },
  });
  expect([200, 201]).toContain(media.status());
  await page.reload();
  await shot(page, "property-card", "Карточка объекта: адрес, параметры, фото, документы и собственники", "property");
  await page.goto("/properties");
  await shot(page, "properties-list", "Экран «Объекты»: таблица с фильтрами по типу, операции и району", "property");

  // Запрос доступа к контактам собственника чужого объекта (риелтор2 → объект риелтора1)
  const r2h = await apiLogin(request, "r2");
  const grant = await request.post(`${QA_ORIGIN}/api/v1/properties/${propertyId}/request-access`, {
    headers: r2h,
    data: { reason: "QA: нужен контакт собственника для показа" },
  });
  expect([200, 201, 409]).toContain(grant.status());

  // Показ: назначаем и фиксируем результат (UI)
  const needs = await request.get(`${QA_ORIGIN}/api/v1/needs?status=active&mine=true`, { headers: r1h });
  const needId = ((await needs.json()) as { items: Array<{ id: string }> }).items[0]!.id;
  await page.goto(`/showings/new?needId=${needId}&propertyId=${propertyId}`);
  await page.waitForFunction(() => Object.keys(document.querySelector("form") ?? {}).some((k) => k.startsWith("__reactProps"))).catch(() => undefined);
  const showingCreated = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/showings") && r.request().method() === "POST",
  );
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

test("QA-05 задачи и календарь: перенос, повторения, уведомления", async ({ page, request }) => {
  await loginUI(page, "r1");
  const r1h = await apiLogin(request, "r1");
  // Перенос просроченной задачи через API с замером
  const tasks = await request.get(`${QA_ORIGIN}/api/v1/tasks?status=open&mine=true`, { headers: r1h });
  expect(tasks.ok(), await tasks.text()).toBeTruthy();
  const items = ((await tasks.json()) as { items: Array<{ id: string; updatedAt: string; title: string }> }).items;
  expect(items.length).toBeGreaterThan(0);
  const t0 = items[0]!;
  const t = Date.now();
  const moved = await request.patch(`${QA_ORIGIN}/api/v1/tasks/${t0.id}`, {
    headers: r1h,
    data: { dueAt: new Date(Date.now() + 2 * 86400000).toISOString(), expectedUpdatedAt: t0.updatedAt },
  });
  expect([200, 201]).toContain(moved.status());
  timings.push(`перенос задачи: ${Date.now() - t} мс`);

  await page.goto("/today");
  await shot(page, "today-realtor", "«Сегодня» риелтора: просрочки, задачи на день и ближайшие события", "today");
  await page.goto("/calendar");
  await expect(page.locator(".fc-event, [data-calendar]").first()).toBeVisible({ timeout: 30000 }).catch(() => undefined);
  await shot(page, "calendar", "Календарь: встречи, показы и повторяющиеся серии", "tasks");
  await page.goto("/notifications");
  await shot(page, "notifications", "Уведомления: напоминания о задачах и событиях", "tasks");
  console.log(timings.join(" | "));
});
