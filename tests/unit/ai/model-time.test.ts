import { describe, expect, it } from "vitest";
import { modelTimeData, modelTimeInstructions } from "@/modules/ai/domain/model-time";

describe("model context time", () => {
  it("crosses midnight in Novosibirsk while UTC is still yesterday", () => {
    expect(modelTimeData({ now: new Date("2026-11-09T17:05:00Z"), tasks: [{ dueAt: "2026-11-09T16:59:00.000Z" }, { dueAt: "2026-11-09T17:00:00Z" }] })).toEqual({
      now: "10.11.2026, 00:05 (Asia/Novosibirsk)", tasks: [{ dueAt: "09.11.2026, 23:59 (Asia/Novosibirsk)" }, { dueAt: "10.11.2026, 00:00 (Asia/Novosibirsk)" }],
    });
  });
  it("uses the configured application zone and explicit input offsets", () => {
    expect(modelTimeData("2026-11-10T00:05:00+07:00", "Europe/Moscow")).toBe("09.11.2026, 20:05 (Europe/Moscow)");
  });
  it("preserves calendar dates, nulls, numeric values, prose and URLs", () => {
    const input = { date: "2026-11-09", missing: null, count: 2, text: "Срок 2026-11-09T17:00:00Z", url: "https://example.org/2026-11-09" };
    expect(modelTimeData(input, "America/Los_Angeles")).toEqual({ ...input, date: "09.11.2026 (календарная дата, America/Los_Angeles)" });
    expect(modelTimeData({ amount: { toJSON: () => "125000.50" } })).toEqual({ amount: "125000.50" });
    expect(input.date).toBe("2026-11-09");
    expect(modelTimeInstructions).toContain("переданное now");
  });
});
