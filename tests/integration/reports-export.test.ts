import { beforeEach, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { apiRequest, db, inDays, makeClient, makeNeed, makeProperty, resetDatabase, routeParams, seedBase, sessionCookieFor, type TestUsers } from "../helpers/fixtures";
import { getManagerReport, getReportDetail, countReactivatedClients } from "@/modules/reports/application/report-service";
import { exportData } from "@/modules/export/application/export-service";
import { registerRequest } from "@/modules/requests/application/request-service";
import { scheduleShowing, recordShowingResult } from "@/modules/showings/application/showing-service";
import { createDeal } from "@/modules/deals/application/deal-service";
import { GET as archiveRoute } from "@/app/api/v1/archive/route";
import { GET as reportRoute } from "@/app/api/v1/reports/manager/route";
import { GET as exportRoute } from "@/app/api/v1/export/route";
import { ForbiddenError } from "@/shared/errors";

let u: TestUsers;
beforeEach(async () => {
  await resetDatabase();
  u = await seedBase();
});

const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe("T09: управленческий отчёт по контрольному набору событий", () => {
  it("агрегаты совпадают с ручным подсчётом исходных событий", async () => {
    // Контрольный набор: 3 обращения (2 avito, 1 cian), 2 потребности, 2 показа (1 проведён: interested), 1 сделка, 1 просрочка.
    const req = (sourceCode: string, need: boolean) =>
      registerRequest(u.realtor1, {
        occurredAt: new Date().toISOString(),
        channelCode: "phone",
        sourceCode,
        summary: need ? "Клиент заинтересован в подборе помещения" : "Клиент отказался от дальнейшего подбора",
        client: { mode: "new", client: { displayName: `Клиент ${sourceCode}${Math.random()}`, contacts: [{ contactType: "phone", value: `+7 901 ${Math.floor(Math.random() * 9000000 + 1000000)}` }] } },
        outcome: need
          ? { resultCode: "new_need", need: { operationType: "rent", propertyType: "commercial" }, nextAction: { title: "Позвонить", dueAt: inDays(-1), taskType: "call_or_contact" } }
          : { resultCode: "no_followup" },
      });
    const r1 = await req("avito", true);
    await req("avito", false);
    const r3 = await req("cian", true);
    const p = await makeProperty(u.realtor1);
    const s1 = await scheduleShowing(u.realtor1, { clientNeedId: r1.needId!, propertyId: p.id, scheduledAt: inDays(0.01) });
    await scheduleShowing(u.realtor1, { clientNeedId: r3.needId!, propertyId: p.id, scheduledAt: inDays(1) });
    const sh = await db.showing.findUniqueOrThrow({ where: { id: s1.id } });
    await recordShowingResult(u.realtor1, s1.id, { expectedUpdatedAt: sh.updatedAt.toISOString(), status: "completed", resultCode: "interested" });
    await createDeal(u.realtor1, { propertyId: p.id, legalEntityId: u.llcId, parties: [{ clientId: r1.clientId!, partyRole: "tenant" }], commissions: [] });

    const rep = await getManagerReport(u.manager, { from: plusDays(-1), to: plusDays(2) });
    const kpi = Object.fromEntries(rep.kpis.map((k) => [k.key, k.value]));
    expect(kpi.newRequests).toBe(await db.leadRequest.count());
    expect(kpi.newRequests).toBe(3);
    expect(rep.requestsBySource.find((s) => s.code === "avito")?.count).toBe(2);
    expect(rep.requestsBySource.find((s) => s.code === "cian")?.count).toBe(1);
    expect(kpi.showings).toBe(2);
    expect(rep.showings.byResult.find((r) => r.code === "interested")?.count).toBe(1);
    expect(rep.funnel.requestsWithNeed).toBe(2);
    expect(rep.funnel.requestToShowing).toBe(2);
    expect(kpi.dealsOpened).toBe(1);
    // просроченные: задачи «Позвонить» со сроком вчера (2 шт.)
    expect(kpi.overdue).toBe(await db.task.count({ where: { status: { in: ["planned", "in_progress"] }, dueAt: { lt: new Date() } } }));
    expect(kpi.overdue).toBe(2);
    expect(rep.needs.nextActionShare).toBe(100);
    // Детализация использует тот же период и ведёт к исходным обращениям.
    const detailUrl = new URL(rep.kpis.find((k) => k.key === "newRequests")!.href!, "http://localhost");
    expect(detailUrl.pathname).toBe("/reports/detail");
    expect(Object.fromEntries(detailUrl.searchParams)).toEqual({ from: plusDays(-1), to: plusDays(2), metric: "newRequests" });
    const detail = await getReportDetail(u.manager, detailUrl.searchParams.get("metric")!, Object.fromEntries(detailUrl.searchParams));
    expect(detail.total).toBe(kpi.newRequests);
    expect(detail.rows.map((r) => r.id).sort()).toEqual((await db.leadRequest.findMany()).map((r) => r.id).sort());
    expect(detail.rows.every((r) => r.href === `/requests/${r.id}`)).toBe(true);
    const realtor1Activity = rep.activity.find((a) => a.user.id === u.realtor1.userId)!;
    expect(realtor1Activity.requests).toBe(3);
    expect(realtor1Activity.showingsCompleted).toBe(1);
  });

  it("повторная активация считается по событиям и паузе REACTIVATION_GAP_DAYS", async () => {
    const { id: oldClient } = await makeClient(u.realtor1);
    await db.client.update({ where: { id: oldClient }, data: { createdAt: new Date(Date.now() - 200 * 86_400_000), status: "inactive" } });
    const { id: freshClient } = await makeClient(u.realtor1); // создан сегодня — не реактивация
    await makeNeed(u.realtor1, oldClient);
    await makeNeed(u.realtor1, freshClient);
    const from = new Date(Date.now() - 86_400_000);
    const to = new Date(Date.now() + 86_400_000);
    expect(await countReactivatedClients(from, to, 90)).toBe(1);
  });

  it("отчёт и архив недоступны риелтору (сервер)", async () => {
    await expect(getManagerReport(u.realtor1)).rejects.toBeInstanceOf(ForbiddenError);
    const cookie = await sessionCookieFor(u.realtor1);
    expect((await reportRoute(apiRequest("GET", "/api/v1/reports/manager", { cookie }), routeParams({}))).status).toBe(403);
    expect((await archiveRoute(apiRequest("GET", "/api/v1/archive", { cookie }), routeParams({}))).status).toBe(403);
    expect((await exportRoute(apiRequest("GET", "/api/v1/export", { cookie }), routeParams({}))).status).toBe(403);
  });
});

describe("UC-14: экспорт ZIP/CSV + manifest", () => {
  it("сохраняет UUID, не содержит секретов и исторического архива", async () => {
    const { id: clientId } = await makeClient(u.realtor1, { displayName: "=CMD|' /C calc'!A0" });
    await db.historicalDealArchive.create({ data: { sourceFile: "x.xlsx", sourceRowKey: "k1", participantName: "Архивный Участник" } });
    const { data, fileName } = await exportData(u.manager);
    expect(fileName).toMatch(/^crm-export-.*\.zip$/);
    const files = unzipSync(data);
    const manifest = JSON.parse(strFromU8(files["manifest.json"]!));
    expect(manifest.files.find((f: { file: string }) => f.file === "clients.csv").rows).toBe(1);
    const clientsCsv = strFromU8(files["clients.csv"]!);
    expect(clientsCsv).toContain(clientId);
    expect(clientsCsv).toContain("'=CMD"); // защита от CSV-инъекции
    const all = Object.values(files).map((f) => strFromU8(f)).join("\n");
    expect(all).not.toMatch(/argon2|password_hash|passwordHash|token_hash|storage_key|storageKey/);
    expect(all).not.toContain("Архивный Участник");
  });
});
