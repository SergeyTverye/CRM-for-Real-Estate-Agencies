import Database from "better-sqlite3";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { APIRequestContext, Page } from "@playwright/test";

export const DESKTOP_ORIGIN = process.env.DESKTOP_QA_URL ?? "http://127.0.0.1:3390";
export const SHOT_DIR = "docs/thesis/screenshots/desktop";
const captions: Array<{ file: string; caption: string; scenario: string }> = [];
let counter = 0;
let initialized = false;

async function ensureInit() {
  if (initialized) return;
  initialized = true;
  try {
    const raw = await readFile(path.join(SHOT_DIR, "captions.json"), "utf8");
    const prev = JSON.parse(raw) as typeof captions;
    captions.push(...prev);
    const nums = (await readdir(SHOT_DIR)).map((f) => Number(f.slice(0, 2))).filter((n) => Number.isInteger(n));
    counter = Math.max(0, ...nums, prev.length);
  } catch {
    // первый прогон
  }
}

export function pw(role: "manager" | "r1" | "r2"): string {
  const v = role === "manager" ? process.env.DESKTOP_QA_PW_MANAGER : role === "r1" ? process.env.DESKTOP_QA_PW_R1 : process.env.DESKTOP_QA_PW_R2;
  if (!v) throw new Error(`DESKTOP_QA_PW_* env missing for ${role}`);
  return v;
}
export function loginOf(role: "manager" | "r1" | "r2"): string {
  return role === "manager" ? "d-manager" : role === "r1" ? "d-realtor1" : "d-realtor2";
}

export async function loginUI(page: Page, role: "manager" | "r1" | "r2") {
  await page.goto("/login");
  await page.getByLabel("Логин").fill(loginOf(role));
  await page.getByLabel("Пароль").fill(pw(role));
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL(/\/(today|clients|requests|needs|properties)/, { timeout: 30000 });
}

export async function shot(page: Page, name: string, caption: string, scenario: string) {
  await ensureInit();
  if (captions.some((c) => c.file.endsWith(`-${name}.png`))) return;
  await mkdir(SHOT_DIR, { recursive: true });
  counter += 1;
  const file = `${String(counter).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: path.join(SHOT_DIR, file) });
  captions.push({ file, caption, scenario });
  await writeFile(path.join(SHOT_DIR, "captions.json"), JSON.stringify(captions, null, 2) + "\n");
}

export async function apiLogin(request: APIRequestContext, role: "manager" | "r1" | "r2") {
  const res = await request.post(`${DESKTOP_ORIGIN}/api/v1/auth/login`, {
    headers: { Origin: DESKTOP_ORIGIN },
    data: { login: loginOf(role), password: pw(role) },
  });
  if (res.status() !== 200) throw new Error(`API login ${role} failed: ${res.status()}`);
  const setCookie = res.headers()["set-cookie"] ?? "";
  const session = setCookie.split(";")[0]!;
  return { Cookie: session, Origin: DESKTOP_ORIGIN, "Content-Type": "application/json" };
}

export async function timed<T>(label: string, fn: () => Promise<T>, log: string[]) {
  const t = Date.now();
  const out = await fn();
  log.push(`${label}: ${Date.now() - t} мс`);
  return out;
}

/** Только чтение: открывает SQLite профиля в readonly для контрольных подсчётов. */
export function openProfileDbReadonly(dbFile: string): Database.Database {
  return new Database(dbFile, { readonly: true });
}

export function profileDbFile(): string {
  const p = process.env.DESKTOP_QA_DB_FILE;
  if (!p) throw new Error("DESKTOP_QA_DB_FILE env missing");
  return p;
}
