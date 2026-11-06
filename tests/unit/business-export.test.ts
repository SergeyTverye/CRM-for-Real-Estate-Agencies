import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { businessLabel, exportDisplayLabel, exportDateLabel, exportCriterion } from "@/modules/export/application/business-labels";
import { tabularExport } from "@/modules/export/application/tabular-export";

describe("Business spreadsheet export", () => {
  it("uses shared Russian labels and never exposes unknown technical codes", () => {
    expect(["cian", "avito", "domclick", "yandex", "mirkvartir", "onrealt", "youla", "web_search", "manual", "import"].map(v => exportDisplayLabel("external_source", v))).toEqual(["Циан", "Авито", "Домклик", "Яндекс Недвижимость", "Мир Квартир", "OnRealt", "Юла", "Веб-поиск", "Ручное добавление", "Импорт выгрузки"]);
    expect(["confirmed", "needs_review", "rejected"].map(v => businessLabel("searchVerdict", v))).toEqual(["Совпадает", "Требует проверки", "Исключено"]);
    for (const code of [null, "unknown", "new_internal_code"]) expect(exportDateLabel("listingDateSource", code)).toBe("Дата неизвестна");
    expect(exportDateLabel("listingDateSource", "cian:structured:publication")).toBe("Публикация площадки");
    expect(exportDateLabel("listingDateSource", "yandex:html_label:update")).toBe("Обновление площадки");
    expect(exportDateLabel("listingDatePrecision", "exact")).toBe("Точный момент");
    expect(exportDisplayLabel("price_unit", "rub_total")).toBe("за объект");
    expect(exportDisplayLabel("price_unit", "per_month")).toBe("в месяц");
    expect(exportDisplayLabel("price_unit", "rub_m2_month")).toBe("за м² в месяц");
    expect(exportDisplayLabel("price_unit", "rub_year")).toBe("в год");
    expect(exportDisplayLabel("property_type", "office")).toBe("Офис");
    expect(businessLabel("externalOperation", "rent")).toBe("Аренда");
    expect(exportCriterion("power_from_50_kW")).toBe("Мощность от 50 кВт");
    expect(exportCriterion("separate_entrance")).toBe("Отдельный вход");
    expect(exportCriterion("private_code")).toBe("Неуточнённое условие");
  });
  it("formats CSV money, area and Date/ISO identically, retains BOM and formula escaping", async () => {
    const types = ["money", "number", "date", "date", "text"] as const;
    const csv = await tabularExport("csv", ["Цена", "Площадь", "Дата", "Проверено", "Заметка"], [["1250000.5", "42.5", new Date("2026-11-05T10:01:00Z"), null, "\u200b=SUM(A1)"], [null, null, "2026-11-05T10:01:00Z", "unknown", "@SUM(A1)"]], "Тест", types);
    expect(Buffer.from(csv).subarray(0, 3).toString("hex")).toBe("efbbbf");
    const text = new TextDecoder().decode(csv);
    expect(text).toContain('"1 250 000,50 ₽";"42,50";"05.11.2026 17:01";"Дата неизвестна"');
    expect(text).toContain("'\u200b=SUM(A1)"); expect(text).toContain("'@SUM(A1)");
    expect(text).not.toContain("unknown");
  });
  it("retains numeric cells, precise dates, safe hyperlinks and literal untrusted text in XLSX", async () => {
    const bytes = await tabularExport("xlsx", ["Цена", "Площадь", "Дата", "URL", "Текст"], [["1250000.5", "42.5", "2026-11-05T10:01:02.123Z", "https://cian.ru/a", "=SUM(A1)"], [null, null, null, "javascript:alert(1)", "@SUM(A1)"]], "Тест", ["money", "number", "date", "url", "text"]);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(bytes) as never);
    const sheet = book.worksheets[0]!;
    expect(sheet.getCell("A2").value).toBe(1250000.5); expect(sheet.getCell("A2").numFmt).toContain('#,##0.00');
    expect(sheet.getCell("B2").value).toBe(42.5); expect(sheet.getCell("B2").numFmt).toContain("0.00");
    expect((sheet.getCell("C2").value as Date).toISOString()).toBe("2026-11-05T17:01:02.123Z");
    expect(sheet.getCell("C2").numFmt).toBe("dd.mm.yyyy hh:mm"); expect(sheet.getCell("C3").text).toBe("Дата неизвестна");
    expect(sheet.getCell("D2").hyperlink).toBe("https://cian.ru/a"); expect(sheet.getCell("D3").hyperlink).toBeUndefined();
    expect(sheet.getCell("E2").text).toBe("'=SUM(A1)"); expect(sheet.getCell("E3").formula).toBeUndefined();
  });
});
