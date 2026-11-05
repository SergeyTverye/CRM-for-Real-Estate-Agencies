import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
const sources = JSON.parse(await readFile("data/v31-shots/render/sources.json", "utf8"));
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const office = process.env.SOFFICE_PATH ?? (process.platform === "win32" ? "C:/Program Files/LibreOffice/program/soffice.com" : "soffice");
const profile = new URL(`file:///${path.resolve("data/v31-shots/lo-profile").replaceAll("\\", "/")}`).href;
for (const format of ["docx", "xlsx"]) {
  const source = sources.find(s => s.format === format);
  execFileSync(office, ["--headless", `-env:UserInstallation=${profile}`, "--convert-to", "pdf", "--outdir", "data/v31-shots/render", source.path], { stdio: "pipe" });
  const pdf = source.path.replace(/\.(docx|xlsx)$/, ".pdf"), prefix = pdf.replace(/\.pdf$/, "");
  execFileSync("pdftoppm", ["-scale-to", "1200", "-png", pdf, prefix], { stdio: "pipe" });
  const file = `generated-${format}.png`, target = `docs/screenshots/vkr/v31/${file}`;
  await sharp(`${prefix}-1.png`).resize(1440, 900, { fit: "contain", background: "#e2e8f0" }).png().toFile(target);
  const record = { file, description: `DEMO · настоящий сформированный ${format.toUpperCase()}, LibreOffice → PDF → Poppler PNG, страница 1/1; без правки содержимого`, mode: "DEMO · синтетика crm_demo; без новых внешних вызовов", date: new Date().toISOString(), sha, workingTree: "uncommitted changes; base HEAD only", role: "REALTOR1", viewport: { width: 1440, height: 900 }, renderer: "LibreOffice + pdftoppm + Sharp contain", sourceChecksum: source.checksum, pdfChecksum: createHash("sha256").update(await readFile(pdf)).digest("hex"), sha256: createHash("sha256").update(await readFile(target)).digest("hex") };
  await writeFile(`data/v31-shots/generated-${format}.json`, JSON.stringify(record, null, 2)+"\n");
  console.log(`Rendered ${file}`);
}
