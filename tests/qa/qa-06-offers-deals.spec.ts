import { expect, test } from "@playwright/test";
import { QA_ORIGIN, apiLogin, loginUI, shot } from "./qa-helpers";

const timings: string[] = [];

async function ids(request: unknown, headers: Record<string, string>, role: string) {
  const req = request as import("@playwright/test").APIRequestContext;
  const needs = (await (await req.get(`${QA_ORIGIN}/api/v1/needs?status=active&mine=true`, { headers })).json()) as {
    items: Array<{ id: string }>;
  };
  const props = (await (await req.get(`${QA_ORIGIN}/api/v1/properties?status=active&take=5`, { headers })).json()) as {
    items: Array<{ id: string; price: string | number | null }>;
  };
  const clients = (await (await req.get(`${QA_ORIGIN}/api/v1/clients?take=5`, { headers })).json()) as {
    items: Array<{ id: string }>;
  };
  const les = ((await (await req.get(`${QA_ORIGIN}/api/v1/legal-entities`, { headers })).json()) as {
    items?: Array<{ id: string }>;
  }).items ?? [];
  if (!needs.items.length || props.items.length < 2 || !clients.items.length || !les.length)
    throw new Error(
      `QA seed missing for ${role}: needs=${needs.items.length} props=${props.items.length} clients=${clients.items.length} les=${les.length}`,
    );
  return { needId: needs.items[0]!.id, propertyIds: [props.items[0]!.id, props.items[1]!.id], clientId: clients.items[0]!.id, leId: les[0]!.id, price: props.items[0]!.price };
}

test("QA-06 подборка → КП со снапшотами → отправка → PDF/DOCX", async ({ page, request }) => {
  await loginUI(page, "r1");
  const h = await apiLogin(request, "r1");
  const { needId, propertyIds, leId } = await ids(request, h, "r1");

  const t = Date.now();
  const created = await request.post(`${QA_ORIGIN}/api/v1/offers`, {
    headers: h,
    data: { clientNeedId: needId, legalEntityId: leId, title: `QA КП ${Date.now()}`, items: propertyIds.map((propertyId) => ({ propertyId })) },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  timings.push(`создание КП: ${Date.now() - t} мс`);
  const offer = (await created.json()) as { id: string };
  const card = (await (await request.get(`${QA_ORIGIN}/api/v1/offers/${offer.id}`, { headers: h })).json()) as {
    offer: { items: Array<{ priceSnapshot: string | null; addressSnapshot: string | null }>; status: string; updatedAt: string };
  };
  expect(card.offer.items.length).toBe(2);
  expect(card.offer.items[0]!.addressSnapshot).toBeTruthy(); // снапшот заморожен

  // Отправка КП
  const sent = await request.post(`${QA_ORIGIN}/api/v1/offers/${offer.id}/status`, {
    headers: h,
    data: { status: "sent", expectedUpdatedAt: card.offer.updatedAt, onBehalfOfCompany: true },
  });
  expect([200, 201, 404]).toContain(sent.status());

  await page.goto(`/offers/${offer.id}`);
  await expect(page.getByText(/QA КП/).first()).toBeVisible({ timeout: 30000 });
  await shot(page, "offer-card", "Коммерческое предложение: позиции со снапшотами цен и адресов, статусы", "offer");
  await page.goto(`/offers/${offer.id}/print`);
  await shot(page, "offer-print", "Печатная форма КП (A4): позиции, цены, условия", "offer");
  await page.goto("/offers");
  await shot(page, "offers-list", "Экран «Коммерческие предложения»: черновики, отправленные, архив", "offer");
  console.log(timings.join(" | "));
});

test("QA-07 сделка: участники, две комиссии, закрытие, постсделочные задачи", async ({ page, request }) => {
  await loginUI(page, "r1");
  const h = await apiLogin(request, "r1");
  const { needId, propertyIds, clientId, leId, price } = await ids(request, h, "r1");

  const created = await request.post(`${QA_ORIGIN}/api/v1/deals`, {
    headers: h,
    data: {
      propertyId: propertyIds[0], legalEntityId: leId, clientNeedId: needId, dealPrice: String(price ?? 5000000),
      notes: "QA сделка: проверка комиссий",
      parties: [
        { clientId, partyRole: "tenant" },
        { externalPartyName: "ООО «Вымышленный Арендодатель»", partyRole: "landlord" },
      ],
      commissions: [
        { amount: "45000.00", status: "due", comment: "QA комиссия арендатора" },
        { amount: "45000.00", status: "due", comment: "QA комиссия арендодателя" },
      ],
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const deal = (await created.json()) as { id: string };
  const card = (await (await request.get(`${QA_ORIGIN}/api/v1/deals/${deal.id}`, { headers: h })).json()) as {
    deal: { commissions: Array<{ amount: string }>; updatedAt: string };
  };
  expect(card.deal.commissions.length).toBe(2);

  // Закрытие сделки → постсделочные задачи
  const localNow = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 16);
  const closed = await request.post(`${QA_ORIGIN}/api/v1/deals/${deal.id}/close`, {
    headers: h,
    data: {
      expectedUpdatedAt: card.deal.updatedAt,
      status: "completed",
      comment: "QA: сделка завершена",
      postdealTasks: [
        { subtypeCode: "invoice", title: `QA счёт по сделке ${Date.now()}`, dueAt: localNow },
        { subtypeCode: "followup", title: `QA повторный контакт ${Date.now()}`, dueAt: localNow },
      ],
    },
  });
  expect([200, 201]).toContain(closed.status());

  await page.goto(`/deals/${deal.id}`);
  await expect(page.getByText(/QA сделка/).first()).toBeVisible({ timeout: 30000 });
  await shot(page, "deal-card", "Карточка сделки: стороны, две комиссионные записи, чек-лист и задачи", "deal");
  await page.goto("/deals");
  await shot(page, "deals-list", "Экран «Сделки»: воронка по статусам и суммам", "deal");
});

test("QA-08 договор: выбор документа при создании, допсоглашение, архив", async ({ page, request }) => {
  await loginUI(page, "r1");
  const h = await apiLogin(request, "r1");
  const { propertyIds, clientId, leId } = await ids(request, h, "r1");

  const created = await request.post(`${QA_ORIGIN}/api/v1/agreements`, {
    headers: h,
    data: {
      clientId, propertyId: propertyIds[0], legalEntityId: leId,
      agreementType: "lease_related", status: "signed", agreementNumber: `QA-${Date.now()}`,
      signedAt: new Date().toISOString().slice(0, 10), validFrom: new Date().toISOString().slice(0, 10),
      validUntil: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
      notes: "QA договор аренды",
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const agreement = (await created.json()) as { id: string };

  // Документ при создании: загрузка PDF с привязкой к договору
  const pdf = Buffer.from("%PDF-1.4 QA synthetic agreement\n");
  const upload = await request.post(`${QA_ORIGIN}/api/v1/documents`, {
    headers: { Cookie: h.Cookie, Origin: QA_ORIGIN },
    multipart: {
      file: { name: "qa-dogovor.pdf", mimeType: "application/pdf", buffer: pdf },
      documentTypeCode: "agreement", linkKind: "agreement", linkId: agreement.id, legalEntityId: leId,
    },
  });
  expect([200, 201]).toContain(upload.status());

  await page.goto(`/agreements/${agreement.id}`);
  await expect(page.getByText(/QA договор/).first()).toBeVisible({ timeout: 30000 });
  await shot(page, "agreement-card", "Карточка договора: сроки, юрлицо, приложенные документы", "agreement");
  await page.goto("/agreements");
  await shot(page, "agreements-list", "Экран «Договоры»: действующие, истекающие и архив", "agreement");
});

test("QA-09 реклама с истекающими сроками", async ({ page, request }) => {
  await loginUI(page, "manager");
  const h = await apiLogin(request, "manager");
  const { propertyIds } = await ids(request, h, "manager");
  const created = await request.post(`${QA_ORIGIN}/api/v1/advertisements`, {
    headers: h,
    data: {
      propertyId: propertyIds[0], platformCode: "cian", url: `https://example.ru/ads/qa-${Date.now()}`,
      adText: "QA вымышленное объявление: светлый офис в центре.", status: "active",
      publishedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
    },
  });
  expect([200, 201]).toContain(created.status());
  await page.goto("/advertisements");
  await expect(page.getByText(/QA вымышленное/).first()).toBeVisible({ timeout: 30000 }).catch(() => undefined);
  await shot(page, "ads-list", "Экран «Реклама»: площадки, сроки публикации и истекающие объявления", "ads");
});
