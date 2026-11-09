import { describe, expect, it, beforeAll } from "vitest";
import { buildSampleWorkbook } from "../../scripts/dev/import-sample-builder";
import { readWorkbook } from "@/modules/import/infrastructure/xlsx-reader";
import { loadProfiles } from "@/modules/import/domain/profiles";
import { detectSections, parseSectionRows, type ParsedRow, type SheetData, type DetectedSection } from "@/modules/import/domain/workbook-parser";
import { parseDate, parseNumber } from "@/modules/import/domain/normalize";

let sheets: SheetData[];
let sections: DetectedSection[];
let rows: ParsedRow[];

beforeAll(async () => {
  sheets = await readWorkbook(await buildSampleWorkbook());
  const profiles = loadProfiles();
  sections = detectSections(sheets, profiles);
  rows = sections.flatMap((s) => parseSectionRows(sheets.find((sh) => sh.name === s.sheetName)!, s, profiles.find((p) => p.code === s.profileCode) ?? null, "f".repeat(64)));
});

describe("импорт: обнаружение секций по сигнатуре", () => {
  it("распознаёт логические секции на одном листе и игнорирует пустой лист", () => {
    const codes = sections.filter((s) => s.status === "recognized").map((s) => s.profileCode);
    expect(codes).toEqual([
      "historical_deals_v1",
      "commercial_rent_objects_v1",
      "commercial_sale_objects_v1",
      "residential_sale_objects_v1",
      "incoming_clients_v1",
      "property_agreement_control_v1",
      "general_ad_objects_v1",
    ]);
    expect(sections.every((s) => s.sheetName === "Лист1")).toBe(true);
  });

  it("секция с маркером, но чужими заголовками — unrecognized и не импортируется", () => {
    const old = sections.find((s) => s.markerText.includes("старый формат"))!;
    expect(old.status).toBe("unrecognized");
    expect(rows.filter((r) => r.sectionKey === old.sectionKey).every((r) => r.validationStatus === "unrecognized")).toBe(true);
  });

  it("паспорт, «выдан», регистрация и дата рождения исключены политикой до формирования результата", () => {
    const hist = sections.find((s) => s.profileCode === "historical_deals_v1")!;
    expect(hist.excludedColumns.map((c) => c.header)).toEqual(["Дата рождения", "Паспорт", "Выдан", "Регистрация"]);
    const histRows = rows.filter((r) => r.profileCode === "historical_deals_v1" && r.validationStatus !== "unrecognized");
    const serialized = JSON.stringify(histRows);
    expect(serialized).not.toContain("0000 000000");
    expect(serialized).not.toContain("УФМС");
    expect(serialized).not.toContain("Регистрационная");
    expect(serialized).not.toContain("1980");
    expect(histRows.every((r) => r.warningCodes.includes("policy_fields_excluded"))).toBe(true);
  });

  it("неоднозначные сокращения не получают придуманного значения", () => {
    const rent = sections.find((s) => s.profileCode === "commercial_rent_objects_v1")!;
    expect(rent.unresolvedColumns.map((c) => c.header)).toEqual(["ОВ", "ЗУ"]);
  });
});

describe("импорт: валидация строк", () => {
  it("историческая секция: 32 строки, ошибки и предупреждения диагностируются", () => {
    const all = rows.filter((r) => r.profileCode === "historical_deals_v1");
    
    expect(all.filter((r) => r.validationStatus === "unrecognized").map((r) => r.warningCodes)).toEqual([["comment_or_separator"]]);
    const hist = all.filter((r) => r.validationStatus !== "unrecognized");
    expect(hist).toHaveLength(32);
    expect(hist.find((r) => (r.record.sourceRowId as string) === "7")?.warningCodes).toContain("invalid_date");
    expect(hist.find((r) => (r.record.sourceRowId as string) === "9")?.warningCodes).toContain("invalid_price");
    expect(hist.find((r) => (r.record.sourceRowId as string) === "5")?.warningCodes).toContain("invalid_phone");
    expect(hist.find((r) => (r.record.sourceRowId as string) === "12")?.validationStatus).toBe("invalid");
  });

  it("входящие клиенты: 22 строки, «Координаты» не превращаются в телефон без подтверждения", () => {
    const inc = rows.filter((r) => r.profileCode === "incoming_clients_v1");
    expect(inc).toHaveLength(22);
    expect(inc.find((r) => r.rowNumber === inc[14]!.rowNumber)?.errorCodes).toContain("missing_name");
    expect(inc[3]!.warningCodes).toContain("invalid_received_date");
    expect(inc.find((r) => (r.record.coordinatesRaw as string)?.includes("@"))?.record.coordinatesKind).toBe("email");
    expect(inc.some((r) => r.warningCodes.includes("unknown_function"))).toBe(true);
  });

  it("объекты: описание очищается от телефона, некорректная ссылка — предупреждение", () => {
    const rent = rows.filter((r) => r.profileCode === "commercial_rent_objects_v1");
    expect(rent[1]!.record.description).toContain("[телефон удалён]");
    expect(rent[2]!.warningCodes).toContain("invalid_url");
    expect(rent[3]!.warningCodes).toContain("owner_ambiguous");
    const res = rows.filter((r) => r.profileCode === "residential_sale_objects_v1");
    expect(res[2]!.errorCodes).toContain("missing_address");
  });

  it("нормализация чисел и дат", () => {
    expect(parseNumber("1 200 000,50 руб.")).toBe("1200000.5");
    expect(parseNumber("85 м²")).toBe("85");
    expect(parseNumber("договорная")).toBeNull();
    expect(parseDate("12.03.2019")?.toISOString().slice(0, 10)).toBe("2019-03-12");
    expect(parseDate("31.02.2015")).toBeNull();
  });
});
