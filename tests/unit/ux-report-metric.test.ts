import { describe, expect, it } from "vitest";
import { metricTitle } from "@/app/(crm)/reports/detail/metric-presentation";
const dictionary = (category: string, code: string) => category === "lead_source" && code === "avito" ? "Авито" : "Телефон";
const employee = () => "Иван Петров";
describe("Report metric titles", () => {
  it("labels grouped sources and statuses in Russian", () => {
    expect(metricTitle("source:avito", dictionary, employee)).toBe("Обращения · Авито");
    expect(metricTitle("showingStatus:completed", dictionary, employee)).toBe("Показы · Проведён");
    expect(metricTitle("showingResult:—", dictionary, employee)).toBe("Результат показов · Не указан");
  });
  it("resolves employee identifiers without including the identifier", () => {
    expect(metricTitle("activity:unreadable-id:tasksCompleted", dictionary, employee)).toBe("Выполненные задачи · Иван Петров");
  });
  it("names unique-need and commission cohorts explicitly", () => {
    expect(metricTitle("requestToShowing", dictionary, employee)).toBe("Потребности с показом после обращения");
    expect(metricTitle("commissions", dictionary, employee)).toBe("Полученные комиссии");
  });
});
