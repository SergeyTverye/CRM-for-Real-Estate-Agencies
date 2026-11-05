import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, zipSync } from "fflate";
import ExcelJS from "exceljs";
import { escapeSpreadsheet, renderText, safeGet } from "@/modules/document-templates/domain/engine";
import { parseManifest } from "@/modules/document-templates/domain/manifest";
import { readPackage } from "@/modules/document-templates/domain/package";
import { fillDocx, fillXlsx, markdownDocx, registryXlsx, shiftFormula } from "@/modules/document-templates/domain/renderers";
import { syntheticContext, projectContext } from "@/modules/document-templates/application/context";
import { clientYaml, collectionYaml, docxFixture, xlsxFixture } from "../helpers/template-fixtures";

describe("AT-15 безопасный шаблонизатор", () => {
  const m = parseManifest(clientYaml), ctx = syntheticContext();
  it("переменные, if, обязательные значения и точная дата Новосибирска", () => {
    expect(renderText("{{#if client.displayName}}{{client.displayName}}{{/if}}", ctx, m)).toContain("Синтетический");
    expect(() => renderText("", {}, m)).toThrow("обязательное");
    const date = parseManifest('schemaVersion: 1\nentityKind: deal\nsources: [deal]\nfields:\n - {path: deal.date, label: Дата, type: date}');
    expect(renderText("{{deal.date}}", ctx, date)).toBe("06.11.2026");
  });
  it.each(["constructor", "client.__proto__", "client.constructor.name", "client[0]", "process.env", "user.passwordHash"])('запрещает %s', path => expect(() => renderText(`{{${path}}}`, ctx, m)).toThrow());
  it("не вызывает getter и не читает прототип", () => {
    expect(safeGet(Object.create({ hidden: "secret" }), "hidden")).toBeUndefined();
    expect(() => safeGet({ get danger() { throw Error("executed"); } }, "danger")).toThrow("Вычисляемые");
  });
  it("манифест запрещает источники, неизвестные поля, YAML aliases, теги и дубли", () => {
    for (const yaml of [clientYaml.replace("client.displayName", "user.passwordHash"), clientYaml.replace("sources: [client, user]", "sources: [deal]"), 'schemaVersion: &v 1\nentityKind: *v', 'x: !evil data', clientYaml + '\nschemaVersion: 1']) expect(() => parseManifest(yaml)).toThrow();
  });
  it("проверяет роль, тип, обязательные поля вне шаблона и проецирует снимок", () => {
    const restricted = parseManifest('schemaVersion: 1\nentityKind: deal\nsources: [legalEntity]\nfields:\n - {path: legalEntity.requisites, label: Реквизиты, type: text, roles: [manager]}');
    expect(() => renderText("{{legalEntity.requisites}}", ctx, restricted, "realtor")).toThrow();
    expect(projectContext(ctx, restricted, "realtor")).toEqual({});
    expect(() => parseManifest(clientYaml.replace('type: text', 'type: date'))).toThrow();
  });
  it("циклы, лимиты вложенности/строк/размера и неверные блоки", () => {
    const c = parseManifest(collectionYaml);
    expect(renderText("{{#each properties}}{{this.address}}\n{{/each}}", ctx, c).split("\n")).toHaveLength(3);
    expect(() => renderText("{{#each properties}}{{this.address}}{{/each}}", { ...ctx, properties: Array(1001).fill({}) }, c)).toThrow();
    expect(() => renderText("{{#if collection.name}}".repeat(10) + "{{/if}}".repeat(10), ctx, c)).toThrow();
    expect(() => renderText("x".repeat(500001), ctx, m)).toThrow();
    expect(() => renderText("{{#if client.displayName}}x{{/each}}", ctx, m)).toThrow();
    expect(() => renderText("{{#each client}}{{/each}}", ctx, m)).toThrow();
  });
  it.each(["=1+1", "+SUM(A1)", "-cmd", "@evil", " \t=1"])("экранирует формулу %s", value => expect(escapeSpreadsheet(value)).toBe("'" + value));
  it("DOCX сохраняет runs/таблицы, раскрывает if и повтор строк", async () => {
    const result = fillDocx(await docxFixture(), ctx, parseManifest(collectionYaml), "manager");
    const xml = strFromU8(readPackage(result)["word/document.xml"]!);
    expect(xml).not.toContain("{{"); expect(xml).toContain("Помещения для проверки"); expect(xml).toContain("Испытательная"); expect(xml).toContain("w:i"); expect(xml.match(/<w:tr>/g)).toHaveLength(3);
  });
  it("Markdown рендерит заголовки, списки и таблицу", async () => {
    const bytes = await markdownDocx("# Клиент\n{{client.displayName}}\n- Пункт\n1. Первый\n| Поле | Значение |\n|---|---|\n| Клиент | {{client.displayName}} |", ctx, m, "manager");
    const xml = strFromU8(readPackage(bytes)["word/document.xml"]!); expect(xml).toContain("w:tbl"); expect(xml).toContain("Heading1");
  });
  it("XLSX имена/стили/формулы/строки; значения данных не становятся формулами", async () => {
    const c = parseManifest(collectionYaml); const hostile = { ...ctx, collection: { name: "=HYPERLINK(1)" } };
    const bytes = await fillXlsx(await xlsxFixture(), hostile, c, "manager"); const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes as never); const s = book.worksheets[0]!;
    expect(s.getCell("A1").value).toBe("'=HYPERLINK(1)"); expect(s.getCell("D3").formula).toBe("C3/B3"); expect(s.getCell("D4").formula).toBe("C4/B4"); expect(s.getCell("B3").value).toBe(82.5); expect(s.getCell("C4").value).toBe(150000); expect(s.getCell("A4").text).toContain("Испытательная"); expect(s.getRow(2).font.bold).toBe(true); expect(s.getRow(4).height).toBe(45);
  });
  it("реестр использует только выбранные поля и экранирует данные", async () => {
    const bytes = await registryXlsx([{ client: { displayName: "+evil" }, user: { displayName: "Тест" } }], m, "manager"); const b = new ExcelJS.Workbook(); await b.xlsx.load(bytes as never); expect(b.worksheets[0]!.getCell("A2").value).toBe("'+evil");
  });
  it("сдвигает относительные A1-формулы повторяемой строки, сохраняя $ и строки", () => {
    expect(shiftFormula('SUM(A3:$B3)+$C$1+IF(D3="A3",1,0)', 2)).toBe('SUM(A5:$B5)+$C$1+IF(D5="A3",1,0)');
  });
  it("форматы площади/денег не меняют стили соседних ячеек после duplicateRow", async () => {
    const bytes = await fillXlsx(await xlsxFixture(), ctx, parseManifest(collectionYaml), "manager"); const b = new ExcelJS.Workbook(); await b.xlsx.load(bytes as never); const s = b.worksheets[0]!;
    expect(s.getCell("B3").numFmt).toContain("м²"); expect(s.getCell("C3").numFmt).toContain("₽"); expect(s.getCell("D3").numFmt ?? "").not.toContain("₽"); expect(s.getCell("B4").numFmt).toContain("м²");
  });
  it.each(["word/vbaProject.bin", "xl/activeX/activeX1.xml", "xl/externalLinks/a.xml", "../escape.xml"])("отклоняет опасный пакет %s", name => {
    expect(() => readPackage(Buffer.from(zipSync({ '[Content_Types].xml': strToU8('<Types/>'), [name]: strToU8('<x/>') })))).toThrow();
  });
  it.each(['<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><x/>', '<Relationships><Relationship TargetMode="External" Target="https://example.test"/></Relationships>', '<Relationships><Relationship TargetMode="Ext&#101;rnal" Target="https://example.test"/></Relationships>'])("отклоняет XML/внешнюю связь", xml => {
    expect(() => readPackage(Buffer.from(zipSync({ '[Content_Types].xml': strToU8(xml) })))).toThrow();
  });
});
