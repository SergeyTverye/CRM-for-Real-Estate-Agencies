import sharp from "sharp";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

const folder = "data/business-export-render";
const target = "docs/screenshots/vkr/v31/search-export-xlsx.png";
const source = "docs/vkr/exports/v31/search-selected.xlsx";
const checksum = async file => createHash("sha256").update(await readFile(file)).digest("hex");
await mkdir(folder, { recursive: true });
if (!process.argv.includes("--reviewed")) {
  const office = process.env.SOFFICE_PATH ?? "C:/Program Files/LibreOffice/program/soffice.com";
  const profile = `file:///${path.resolve(`${folder}/lo-profile`).replaceAll("\\", "/")}`;
  execFileSync(office, ["--headless", `-env:UserInstallation=${profile}`, "--convert-to", "pdf", "--outdir", folder, source], { stdio: "pipe", timeout: 60000 });
  execFileSync("pdftoppm", ["-scale-to", "1500", "-png", `${folder}/search-selected.pdf`, `${folder}/page`], { stdio: "pipe" });
  const panels = [];
  for (const [index, page] of [1, 2, 4, 5].entries()) {
    const input = await sharp(`${folder}/page-${page}.png`).trim({ background: "#ffffff", threshold: 12 }).toBuffer();
    panels.push({ input: await sharp(input).resize(950, 500, { fit: "contain", background: "white" }).png().toBuffer(), left: 20 + index % 2 * 990, top: 20 + Math.floor(index / 2) * 540 });
  }
  await sharp({ create: { width: 1980, height: 1080, channels: 3, background: "#e2e8f0" } }).composite(panels).png().toFile(target);
  const pages = [];
  for (let page = 1; page <= 8; page++) pages.push({ input: await sharp(`${folder}/page-${page}.png`).trim({ background: "#ffffff", threshold: 12 }).resize(950, 500, { fit: "contain", background: "white" }).png().toBuffer(), left: 20 + (page - 1) % 2 * 990, top: 20 + Math.floor((page - 1) / 2) * 540 });
  await sharp({ create: { width: 1980, height: 2160, channels: 3, background: "#e2e8f0" } }).composite(pages).png().toFile(`${folder}/all-pages.png`);
  console.log("Rendered native XLSX. View target and all-pages.png, then use --reviewed.");
} else {
  const manifestFile = "docs/screenshots/vkr/v31/manifest.json";
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  const record = manifest.find(item => item.file === "search-export-xlsx.png");
  Object.assign(record, {
    mode: "REPLAY · сохранённые LIVE-результаты crm_demo; без новых вызовов площадок и ИИ",
    description: "Штатный XLSX: русские бизнес-метки, даты, цены и площади. Контактный лист страниц LibreOffice PDF 1,2,4,5 из 8; только обрезка белых полей и пропорциональный размер.",
    renderer: "LibreOffice → PDF → pdftoppm → Sharp contact sheet",
    date: new Date().toISOString(), sourceChecksum: await checksum(source), pdfChecksum: await checksum(`${folder}/search-selected.pdf`), sha256: await checksum(target),
    sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), workingTree: "uncommitted business export changes; SHA is base HEAD",
    evidence: "docs/vkr/business-export-refresh.json", visualReview: "PASS · просмотрены все 8 страниц и итоговый кадр; метки, числа, даты и ссылки читаемы", reviewedAt: new Date().toISOString(),
  });
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
  const sums = "docs/screenshots/vkr/v31/SHA256SUMS";
  await writeFile(sums, (await readFile(sums, "utf8")).replace(/^[a-f0-9]{64}  search-export-xlsx\.png$/mu, `${record.sha256}  search-export-xlsx.png`));
  console.log("Updated reviewed screenshot manifest and SHA256SUMS.");
}
