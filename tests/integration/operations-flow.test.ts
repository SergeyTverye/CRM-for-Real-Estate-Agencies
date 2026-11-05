import { beforeEach, describe, expect, it } from "vitest";
import { db, inDays, makeClient, makeNeed, makeProperty, nextAction, resetDatabase, seedBase, type TestUsers } from "../helpers/fixtures";
import { proposeProperties, findCandidates } from "@/modules/matching/application/matching-service";
import { scheduleShowing, recordShowingResult } from "@/modules/showings/application/showing-service";
import { getTodayView } from "@/modules/tasks/application/task-queries";
import { createAgreement } from "@/modules/agreements/application/agreement-service";
import { createAdvertisement } from "@/modules/advertisements/application/advertisement-service";
import { globalSearch } from "@/modules/search/application/search-service";
import { createClient } from "@/modules/clients/application/client-service";
import { DomainError, ValidationError } from "@/shared/errors";

let u: TestUsers;
beforeEach(async () => {
  await resetDatabase();
  u = await seedBase();
});

async function showingVersion(id: string) {
  return (await db.showing.findUniqueOrThrow({ where: { id } })).updatedAt.toISOString();
}

describe("T04: подбор → показ → результат → этап → следующее действие", () => {
  it("полная цепочка сохраняет историю и требует продолжения атомарно", async () => {
    const { id: clientId } = await makeClient(u.realtor1);
    const { id: needId } = await makeNeed(u.realtor1, clientId);
    const p1 = await makeProperty(u.realtor2, { price: "90000.00" });
    const p2 = await makeProperty(u.realtor1, { price: "500000.00" });

    const cand = await findCandidates(u.realtor1, needId, { strict: "no" });
    const s1 = cand.items.find((i) => i.id === p1.id)!;
    const s2 = cand.items.find((i) => i.id === p2.id)!;
    expect(s1.score).toBeGreaterThan(s2.score); // p2 вне бюджета
    expect(JSON.stringify(cand.items)).not.toMatch(/owner|contacts/i);

    const proposed = await proposeProperties(u.realtor1, needId, { propertyIds: [p1.id, p2.id] });
    expect(proposed.created).toHaveLength(2);
    expect((await db.clientNeed.findUniqueOrThrow({ where: { id: needId } })).stage).toBe("selection");
    // повторное предложение активного варианта не дублируется
    expect((await proposeProperties(u.realtor1, needId, { propertyIds: [p1.id] })).skipped).toEqual([p1.id]);

    const sh = await scheduleShowing(u.realtor1, { clientNeedId: needId, propertyId: p1.id, scheduledAt: inDays(1) });
    expect((await db.clientNeed.findUniqueOrThrow({ where: { id: needId } })).stage).toBe("showing");
    const match = await db.needPropertyMatch.findFirstOrThrow({ where: { clientNeedId: needId, propertyId: p1.id } });
    expect(match.status).toBe("showing_planned");

    // Завершаем исходную задачу, чтобы задача показа стала единственной открытой.
    const firstTask = await db.task.findFirstOrThrow({ where: { needLinks: { some: { clientNeedId: needId } }, taskType: "call_or_contact" } });
    await db.task.update({ where: { id: firstTask.id }, data: { status: "completed", completedAt: new Date() } });

    // Результат без продолжения — потребность осталась бы без next action → откат всей команды.
    const err = await recordShowingResult(u.realtor1, sh.id, { expectedUpdatedAt: await showingVersion(sh.id), status: "completed", resultCode: "interested" }).catch((e) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe("NEXT_ACTION_REQUIRED");
    expect((await db.showing.findUniqueOrThrow({ where: { id: sh.id } })).status).toBe("planned");

    // Результат + переход этапа + следующее действие одной командой.
    await recordShowingResult(u.realtor1, sh.id, {
      expectedUpdatedAt: await showingVersion(sh.id),
      status: "completed",
      resultCode: "negotiation",
      comment: "Клиент готов обсуждать условия",
      needChange: { stage: "negotiation", nextAction: { ...nextAction("Согласовать условия аренды", 2) } },
    });
    const showing = await db.showing.findUniqueOrThrow({ where: { id: sh.id } });
    expect([showing.status, showing.resultCode]).toEqual(["completed", "negotiation"]);
    expect(showing.occurredAt).not.toBeNull();
    const need = await db.clientNeed.findUniqueOrThrow({ where: { id: needId } });
    expect(need.stage).toBe("negotiation");
    const history = await db.needStageHistory.findMany({ where: { clientNeedId: needId }, orderBy: { occurredAt: "asc" } });
    expect(history.map((h) => h.toStage)).toEqual(["new", "selection", "showing", "negotiation"]);
    expect(history.at(-1)?.reasonCode).toBe("showing:negotiation");
    const open = await db.task.findMany({ where: { needLinks: { some: { clientNeedId: needId } }, status: "planned" } });
    expect(open.map((t) => t.title)).toEqual(["Согласовать условия аренды"]);
    expect((await db.needPropertyMatch.findUniqueOrThrow({ where: { id: match.id } })).status).toBe("interested");
  });

  it("закрытие потребности по итогам показа требует причины", async () => {
    const { id: clientId } = await makeClient(u.realtor1);
    const { id: needId } = await makeNeed(u.realtor1, clientId);
    const p = await makeProperty(u.realtor1);
    const sh = await scheduleShowing(u.realtor1, { clientNeedId: needId, propertyId: p.id, scheduledAt: inDays(1) });
    await expect(
      recordShowingResult(u.realtor1, sh.id, { expectedUpdatedAt: await showingVersion(sh.id), status: "completed", resultCode: "rejected", needChange: { status: "closed" } }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      recordShowingResult(u.realtor1, sh.id, { expectedUpdatedAt: await showingVersion(sh.id), status: "completed", resultCode: "rejected", needChange: { status: "closed", stopReasonCode: "no_match" } }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await db.showing.findUniqueOrThrow({ where: { id: sh.id } })).status).toBe("planned");
    expect((await db.clientNeed.findUniqueOrThrow({ where: { id: needId } })).status).toBe("active");
    await recordShowingResult(u.realtor1, sh.id, {
      expectedUpdatedAt: await showingVersion(sh.id),
      status: "completed",
      resultCode: "rejected",
      needChange: { status: "closed", stopReasonCode: "client_refused" },
    });
    expect(await db.clientNeed.findUniqueOrThrow({ where: { id: needId } })).toMatchObject({ status: "closed", stopReasonCode: "client_refused", closedAt: expect.any(Date) });
  });
});

describe("FR-25/FR-26: экран «Сегодня» и контрольные даты", () => {
  it("группирует задачи, показывает просрочку и истекающие договоры/рекламу", async () => {
    const { id: clientId } = await makeClient(u.realtor1);
    await makeNeed(u.realtor1, clientId, { nextAction: { title: "Перезвонить", dueAt: new Date(Date.now() - 3_600_000).toISOString(), taskType: "call_or_contact" } });
    await makeNeed(u.realtor1, clientId, { nextAction: { title: "Встреча в офисе", dueAt: new Date(Date.now() + 3_600_000).toISOString(), taskType: "showing_or_meeting" } });
    const p = await makeProperty(u.realtor1);
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    await createAgreement(u.realtor1, { propertyId: p.id, agreementType: "exclusive", status: "signed", signedAt: "2026-01-10", validUntil: soon, legalEntityId: u.llcId });
    await createAdvertisement(u.realtor1, { propertyId: p.id, platformCode: "avito", status: "active", url: "https://example.ru/ad/1", expiresAt: soon });

    const view = await getTodayView(u.realtor1);
    expect(view.overdue.map((t) => t.title)).toContain("Перезвонить");
    expect(view.counters.overdue).toBeGreaterThanOrEqual(1);
    const meetingsToday = view.today.meetings.map((t) => t.title);
    const meetingsWeek = view.week.map((t) => t.title);
    expect([...meetingsToday, ...meetingsWeek]).toContain("Встреча в офисе");
    expect(view.controls.documents.some((c) => c.kind === "agreement")).toBe(true);
    expect(view.controls.advertising.some((c) => c.kind === "advertisement")).toBe(true);
    expect(view.counters.needsWithoutNextAction).toBe(0);

    // Другой риелтор не видит чужие действия, руководитель видит «Все».
    const other = await getTodayView(u.realtor2);
    expect(other.overdue).toHaveLength(0);
    const all = await getTodayView(u.manager, { scope: "all" });
    expect(all.overdue.map((t) => t.title)).toContain("Перезвонить");
  });

  it("подписанный договор требует дату подписания и ИП/ООО", async () => {
    const p = await makeProperty(u.realtor1);
    await expect(createAgreement(u.realtor1, { propertyId: p.id, agreementType: "information", status: "signed", signedAt: "2026-01-10" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createAgreement(u.realtor1, { agreementType: "information", status: "draft" })).rejects.toBeInstanceOf(ValidationError);
    const a = await createAgreement(u.realtor1, { propertyId: p.id, agreementType: "information", status: "no_agreement", absenceReasonCode: "owner_refused", actionRequired: "Повторно предложить договор" });
    expect((await db.agreement.findUniqueOrThrow({ where: { id: a.id } })).absenceReasonCode).toBe("owner_refused");
  });
});

describe("FR-31: глобальный поиск не раскрывает чужих клиентов", () => {
  it("поиск по телефону чужого клиента ничего не возвращает риелтору", async () => {
    await createClient(u.realtor1, { displayName: "Скрытый Клиент", contacts: [{ contactType: "phone", value: "+7 912 444-55-66" }] });
    const r2 = await globalSearch(u.realtor2, "912 444");
    const r2Text = JSON.stringify(r2);
    expect(r2Text).not.toContain("Скрытый");
    expect(r2.groups.find((g) => g.kind === "clients")?.items).toHaveLength(0);
    const r1 = await globalSearch(u.realtor1, "4445566");
    expect(r1.groups.find((g) => g.kind === "clients")?.items[0]?.title).toBe("Скрытый Клиент");
    const m = await globalSearch(u.manager, "Скрытый");
    expect(m.groups.find((g) => g.kind === "clients")?.items).toHaveLength(1);
  });
});
