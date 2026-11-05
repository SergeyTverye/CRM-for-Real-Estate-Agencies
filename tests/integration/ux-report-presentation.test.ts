import { beforeEach, describe, expect, it } from "vitest";
import { reportRecord } from "@/app/(crm)/reports/detail/record-presentation";
import { getReportDetail } from "@/modules/reports/application/report-service";
import { scheduleShowing } from "@/modules/showings/application/showing-service";
import { registerRequest } from "@/modules/requests/application/request-service";
import { resetDatabase, seedBase, makeClient, makeNeed, makeProperty, inDays, type TestUsers } from "../helpers/fixtures";
let users: TestUsers;
beforeEach(async () => { await resetDatabase(); users = await seedBase(); });
describe("Report record presentation", () => {
  it("resolves request names through authorized queries without changing cohort IDs", async () => {
    const client = await makeClient(users.realtor1, { displayName: "Тестовый арендатор" });
    await registerRequest(users.realtor1, { occurredAt: new Date().toISOString(), channelCode: "phone", sourceCode: "avito", summary: "Уточнение аренды офиса", client: { mode: "existing", clientId: client.id }, outcome: { resultCode: "no_followup" } });
    const detail = await getReportDetail(users.manager, "newRequests");
    expect(detail.total).toBe(1);
    const row = detail.rows[0]!;
    const display = await reportRecord(users.manager, row);
    expect(display.label).toBe("Уточнение аренды офиса");
    expect(display.client).toEqual({ id: client.id, label: "Тестовый арендатор", href: `/clients/${client.id}` });
    expect(display.status).toBe("Закрыто");
    expect(display.sourceCode).toBe("avito");
    expect(display.employee).toBeTruthy();
    expect(display.at).toBeInstanceOf(Date);
  });
  it("links a showing by property address and client name with a Russian status", async () => {
    const client = await makeClient(users.realtor1, { displayName: "Тестовый клиент" });
    const need = await makeNeed(users.realtor1, client.id);
    const property = await makeProperty(users.realtor1, { addressText: "Новосибирск, Тестовая, 1" });
    const showing = await scheduleShowing(users.realtor1, { clientNeedId: need.id, propertyId: property.id, scheduledAt: inDays(1) });
    const display = await reportRecord(users.manager, { id: showing.id, href: `/showings/${showing.id}`, label: "Показ" });
    expect(display.label).toBe("Показ · Новосибирск, Тестовая, 1");
    expect(display.property?.href).toBe(`/properties/${property.id}`);
    expect(display.client?.label).toBe("Тестовый клиент");
    expect(display.status).toBe("Запланирован");
    expect(display.label).not.toContain(showing.id);
  });
  it("does not enrich an inaccessible foreign need", async () => {
    const client = await makeClient(users.realtor2);
    const need = await makeNeed(users.realtor2, client.id);
    await expect(reportRecord(users.realtor1, { id: need.id, href: `/needs/${need.id}`, label: "Потребность" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
