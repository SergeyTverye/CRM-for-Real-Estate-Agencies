import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";

const profiler = path.resolve("scripts/private-import/profile-workbook.mjs");
const generator = path.resolve("scripts/private-import/make-synthetic-workbook.mjs");
const fixture = path.resolve("tests/fixtures/synthetic/workbook-like.xlsx");
function run(input = fixture) {
  const dir = mkdtempSync(path.join(tmpdir(), "private-profiler-"));
  const out = path.join(dir, "profile.json");
  const stdout = execFileSync(process.execPath, [profiler, input, "--out", out], { encoding: "utf8" });
  expect(readFileSync(out, "utf8")).toBe(stdout);
  return { json: JSON.parse(stdout), stdout, out };
}
function strings(value: unknown, result = new Set<string>()): Set<string> {
  if (typeof value === "string") result.add(value);
  else if (Array.isArray(value)) value.forEach(v => strings(v, result));
  else if (value && typeof value === "object") Object.values(value).forEach(v => strings(v, result));
  return result;
}
describe("trusted private workbook profiler (synthetic only)", () => {
  it("omits every source cell string, sheet name, header, formula, format, note and URL", async () => {
    execFileSync(process.execPath, [generator, fixture]);
    const { stdout, json } = run();
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(fixture);
    const originals = new Set<string>();
    wb.eachSheet(ws => {
      originals.add(ws.name);
      ws.eachRow(row => row.eachCell(cell => {
        strings(cell.value, originals); strings(cell.note, originals);
        if (cell.numFmt) originals.add(cell.numFmt);
      }));
    });
    wb.definedNames.model.forEach(n => originals.add(n.name));
    for (const s of originals) expect(stdout.includes(s), `source string leaked (${s.length} characters)`).toBe(false);
    expect(json.sheetCount).toBe(3);
    expect(json.sheets.map((s: {visibility: string}) => s.visibility)).toEqual(["visible", "hidden", "veryHidden"]);
    expect(json.sheets[0]).toMatchObject({ mergedRanges: ["A1:K1"], hiddenRowCount: 1, hiddenColumnIndices: [7], autoFilter: "A2:K5", imageCount: 1, commentCount: 1, hyperlinkCount: 2, duplicateRows: 1, duplicateAddressArea: 1, conditionalFormattingCount: 1, dataValidationCount: 1 });
    expect(json.sheets[0].blocks.map((b: {headerRow: number}) => b.headerRow)).toEqual([2,8]);
    const cols = json.sheets[0].blocks[0].columns;
    expect(cols[0].header.class).toBe("address");
    expect(cols[1].header.class).toBe("area_m2");
    expect(cols[3].signals.phone).toBe(1);
    expect(cols[4].signals.email).toBe(1);
    expect(cols[2].signals.monetaryFormat).toBe(1);
    expect(cols[8].formulaShapes[0].functions).toEqual(["IF", "SUM"]);
    expect(cols[10].header.unresolved).toBe(true);
    expect(json.definedNameCount).toBe(1);
    expect(json.externalLinks).toBe(false);
    expect(json.macros).toBe(false);
  });
  it("counts external workbook links without exposing their targets", () => {
    const dir=mkdtempSync(path.join(tmpdir(),"private-profiler-external-"));
    const zip=unzipSync(readFileSync(fixture));
    const key="xl/_rels/workbook.xml.rels";
    zip[key]=strToU8(strFromU8(zip[key]!).replace("</Relationships>", '<Relationship Id="rIdPrivateExternal" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="externalLinks/externalLink1.xml"/></Relationships>'));
    zip["xl/externalLinks/externalLink1.xml"]=strToU8('<externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><externalBook/></externalLink>');
    const input=path.join(dir,"external.xlsx");writeFileSync(input,zipSync(zip));
    const {json,stdout}=run(input);expect(json.externalLinks).toBe(true);
    expect(stdout).not.toContain("rIdPrivateExternal");expect(stdout).not.toContain("externalLink1.xml");
  });
  it("rejects macro payloads and warning-producing sheet names with no text leakage", () => {
    const dir=mkdtempSync(path.join(tmpdir(),"private-profiler-reject-"));
    for(const variant of ["macro","name"]) {
      const zip=unzipSync(readFileSync(fixture));
      if(variant==="macro")zip["xl/vbaProject.bin"]=strToU8("SENSITIVE_MACRO_PAYLOAD");
      else zip["xl/workbook.xml"]=strToU8(strFromU8(zip["xl/workbook.xml"]!).replace('name="СИНТЕТИКА_основной_лист"','name="SENSITIVE_SHEET_NAME_LONGER_THAN_31_CHARACTERS"'));
      const input=path.join(dir,`${variant}.xlsx`);writeFileSync(input,zipSync(zip));
      const result=spawnSync(process.execPath,[profiler,input,"--out",path.join(dir,`${variant}.json`)],{encoding:"utf8"});
      expect(result.status).toBe(1);expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/^PROFILE_FAILED:/);expect(result.stderr).not.toContain("SENSITIVE");
    }
  });
  it("reports corrupt input without echoing path or parser details", () => {
    const dir=mkdtempSync(path.join(tmpdir(),"private-profiler-corrupt-"));
    const input=path.join(dir,"SENSITIVE_FILENAME.xlsx");writeFileSync(input,"SENSITIVE_CORRUPT_CONTENT");
    const result=spawnSync(process.execPath,[profiler,input,"--out",path.join(dir,"out.json")],{encoding:"utf8"});
    expect(result.status).toBe(1);expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^PROFILE_FAILED:/);
    expect(result.stderr).not.toContain("SENSITIVE");
  });
  it("refuses overwrite and keeps the existing output intact", () => {
    const {out}=run(); const before=readFileSync(out,"utf8");
    const result=spawnSync(process.execPath,[profiler,fixture,"--out",out],{encoding:"utf8"});
    expect(result.status).toBe(1);expect(result.stdout).toBe("");expect(readFileSync(out,"utf8")).toBe(before);
  });
});

