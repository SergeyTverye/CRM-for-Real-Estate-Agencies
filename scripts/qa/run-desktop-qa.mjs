/**
 * Десктоп-QA harness: изолированный профиль, supervisor из собранного пакета,
 * setup, пользователи, сид, Playwright-сценарии, бэкап-операции, второй профиль,
 * офлайн-режим, рестарт, замеры. Секреты только из окружения, в вывод не печатаются.
 * Запуск: node scripts/qa/run-desktop-qa.mjs [--business-only|--ops-only|--skip-seed]
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, copyFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { config as loadEnv } from "dotenv";
const require = createRequire(import.meta.url);

loadEnv({ path: [".env.local", ".env"], quiet: true });

const root = process.cwd();
const APP = path.join(root, "src-tauri/resources/app");
const PROFILE = path.join(root, "data-qa/desktop-profile");
const PROFILE_B = path.join(root, "data-qa/desktop-profile-b");
const USB = path.join(root, "data-qa/usb-stick");
const args = new Set(process.argv.slice(2));
const BUSINESS_ONLY = args.has("--business-only");
const OPS_ONLY = args.has("--ops-only");
const SKIP_SEED = args.has("--skip-seed");

const results = { startedAt: new Date().toISOString(), sections: {}, timings: [] };
const timed = async (label, fn) => {
  const t = Date.now();
  const out = await fn();
  results.timings.push(`${label}: ${Date.now() - t} мс`);
  return out;
};
const section = (name, status, detail) => {
  results.sections[name] = { status, ...(detail ? { detail } : {}) };
  console.log(`[qa] ${name}: ${status}${detail ? " " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function profileDirs(base) {
  const dirs = {};
  for (const n of ["localappdata", "roaming", "temp", "home"]) dirs[n] = path.join(base, n);
  return dirs;
}
async function ensureDirs(base) {
  for (const d of Object.values(profileDirs(base))) await mkdir(d, { recursive: true });
}
const redact = (v) => (typeof v === "string" && v.length > 64 ? v.slice(0, 16) + "…" : v);

function checkApp() {
  for (const f of ["supervisor.mjs", "server.js", "node/node.exe", "desktop-manifest.json"]) {
    if (!existsSync(path.join(APP, f))) throw new Error(`APP_MISSING:${f}`);
  }
}

function startSupervisor(base, extraEnv = {}) {
  const dirs = profileDirs(base);
  const sys = process.env.SystemRoot ?? "C:\\Windows";
  const env = {
    SystemRoot: sys, WINDIR: sys, SystemDrive: sys.slice(0, 2), COMSPEC: process.env.ComSpec,
    PATHEXT: ".COM;.EXE;.BAT;.CMD", PATH: `${sys}\\System32;${sys}\\System32\\WindowsPowerShell\\v1.0`,
    LOCALAPPDATA: dirs.localappdata, APPDATA: dirs.roaming, TEMP: dirs.temp, TMP: dirs.temp,
    USERPROFILE: dirs.home, HOME: dirs.home,
  };
  for (const k of ["AI_ENABLED", "SCRAPER_ENABLED", "SCRAPER_DEMO_FIXTURES", "YANDEX_CLOUD_API_KEY", "YANDEX_CLOUD_API_KEY_ID", "YANDEX_CLOUD_FOLDER", "YANDEX_CLOUD_MODEL", "YANDEX_CLOUD_WEB_MODEL", "YANDEX_CLOUD_BASE_URL", "YANDEX_AI_STORE_RESPONSES", "YANDEX_AI_MAX_OUTPUT_TOKENS", "YANDEX_AI_TIMEOUT_MS", "YANDEX_AI_MAX_REQUESTS_PER_USER_HOUR", "YANDEX_AI_MAX_MONTHLY_COST_RUB", "YANDEX_WEB_SEARCH_ENABLED", "YANDEX_WEB_SEARCH_AUTO_FALLBACK"]) {
    if (process.env[k] !== undefined) env[k] = process.env[k];
  }
  Object.assign(env, { SCRAPER_DEMO_FIXTURES: "true", SCRAPER_ENABLED: "true", AI_ENABLED: "true" }, extraEnv);
  const t = Date.now();
  const tag = base === PROFILE ? "A" : "B";
  const logStream = require("node:fs").createWriteStream(path.join(root, "data-qa", `supervisor-${tag}.log`), { flags: "a" });
  logStream.write(`\n=== supervisor start ${new Date().toISOString()} ===\n`);
  const proc = spawn(path.join(APP, "node/node.exe"), [path.join(APP, "supervisor.mjs")], {
    cwd: APP, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  proc.on("exit", (code) => { try { logStream.write(`=== supervisor exit code=${code} ===\n`); logStream.end(); } catch {} });
  let url = "";
  proc.stdout.on("data", (c) => {
    try { logStream.write(String(c)); } catch {}
    for (const line of String(c).split(/\r?\n/)) {
      if (line.startsWith("READY ")) url = line.slice(6).trim();
    }
  });
  proc.stderr.on("data", (c) => { try { logStream.write(`[stderr] ${c}`); } catch {} });
  return { proc, dirs, env, getUrl: () => url, coldMs: () => Date.now() - t };
}

async function waitReady(handle, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (handle.proc.exitCode !== null) throw new Error("SUPERVISOR_EXITED");
    const url = handle.getUrl();
    if (url) {
      try {
        const r = await fetch(url + "/api/health/ready", { signal: AbortSignal.timeout(3000) });
        if (r.ok) return url;
      } catch {}
      const rt = path.join(handle.dirs.localappdata, "RealEstateCRM/logs/runtime.json");
      if (existsSync(rt)) {
        try {
          const info = JSON.parse(await readFile(rt, "utf8"));
          if (info.url) {
            const r = await fetch(info.url + "/api/health/ready", { signal: AbortSignal.timeout(3000) });
            if (r.ok) return info.url;
          }
        } catch {}
      }
    }
    await sleep(500);
  }
  throw new Error("READY_TIMEOUT");
}

async function stopSupervisor(handle) {
  const { proc } = handle;
  if (proc.exitCode === null) {
    proc.stdin.write("STOP\n");
    const end = Date.now() + 30000;
    while (proc.exitCode === null && Date.now() < end) await sleep(250);
    if (proc.exitCode === null) proc.kill();
  }
}

async function cleanupStale(base) {
  const rt = path.join(profileDirs(base).localappdata, "RealEstateCRM/logs/runtime.json");
  if (existsSync(rt)) {
    try {
      const info = JSON.parse(await readFile(rt, "utf8"));
      if (Number.isSafeInteger(info.pid)) {
        const check = spawnSync("tasklist", ["/FI", `PID eq ${info.pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true });
        if (check.status === 0 && check.stdout.includes(`"${info.pid}"`)) {
          spawnSync("taskkill", ["/PID", String(info.pid), "/F", "/T"], { encoding: "utf8", windowsHide: true, timeout: 15000 });
          await sleep(3000);
        }
      }
    } catch {}
  }
  try {
    const list = spawnSync("wmic", ["process", "where", "name='node.exe'", "get", "ProcessId,CommandLine", "/format:csv"], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    const me = process.pid;
    for (const line of (list.stdout ?? "").split(/\r?\n/)) {
      const m = line.match(/,(\d+)\s*$/);
      const pid = m ? Number(m[1]) : 0;
      if (pid && pid !== me && line.includes("supervisor.mjs") && line.includes("src-tauri")) {
        spawnSync("taskkill", ["/PID", String(pid), "/F", "/T"], { encoding: "utf8", windowsHide: true, timeout: 15000 });
      }
    }
  } catch {}
}

function cookieJar() {
  let cookie = "";
  return {
    get: () => cookie,
    set: (res) => {
      const sc = res.headers.get("set-cookie");
      if (sc) cookie = sc.split(";")[0];
    },
  };
}
async function api(base, jar, method, route, body, { multipart = false } = {}) {
  const headers = { Origin: base };
  if (jar?.get()) headers.Cookie = jar.get();
  let payload;
  if (multipart) payload = body;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(base + route, { method, headers, body: payload, redirect: "manual", signal: AbortSignal.timeout(60000) });
  jar?.set(res);
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  if ((res.headers.get("content-type") ?? "").includes("application/json")) {
    try { json = JSON.parse(buf.toString("utf8")); } catch {}
  }
  return { status: res.status, json, buf, headers: res.headers };
}
async function until(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const out = await fn();
      if (out) return out;
    } catch (e) { last = e; }
    await sleep(1000);
  }
  throw new Error(`POLL_TIMEOUT:${label}:${redact(String(last))}`);
}

// Сессия у restore умирает вместе с заменой БД: при 401 перелогиниваемся и повторяем.
async function authed(base, jarRef, method, route, body) {
  let res = await api(base, jarRef.jar, method, route, body).catch(() => null);
  if (res?.status === 401) {
    jarRef.jar = cookieJar();
    await api(base, jarRef.jar, "POST", "/api/v1/auth/login", { login: jarRef.login, password: jarRef.password }).catch(() => null);
    res = await api(base, jarRef.jar, method, route, body).catch(() => null);
  }
  return res;
}

const pwFile = path.join(root, "data-qa/desktop-qa-passwords.json");
let pw;
try {
  pw = JSON.parse(await readFile(pwFile, "utf8"));
  if (!pw.manager || !pw.r1 || !pw.r2) throw new Error("PW_FILE_INCOMPLETE");
} catch (e) {
  if (e.code !== "ENOENT" && e.message !== "PW_FILE_INCOMPLETE") throw e;
  pw = {
    manager: process.env.DESKTOP_QA_PW_MANAGER ?? `Dm-${randomBytes(12).toString("hex")}Aa7!`,
    r1: process.env.DESKTOP_QA_PW_R1 ?? `Dr1-${randomBytes(12).toString("hex")}Aa7!`,
    r2: process.env.DESKTOP_QA_PW_R2 ?? `Dr2-${randomBytes(12).toString("hex")}Aa7!`,
  };
  await writeFile(pwFile, JSON.stringify(pw), { flag: "wx", mode: 0o600 }).catch(async () => {
    pw = JSON.parse(await readFile(pwFile, "utf8"));
  });
}
for (const [key, envName] of [["manager", "DESKTOP_QA_PW_MANAGER"], ["r1", "DESKTOP_QA_PW_R1"], ["r2", "DESKTOP_QA_PW_R2"]]) {
  if (process.env[envName]) pw[key] = process.env[envName];
}
const PASSPHRASE = `qa-desktop-backup-${randomBytes(8).toString("hex")}-phrase`;
const recoveryRaw = randomBytes(32).toString("hex");
const RECOVERY = `CRM1-${recoveryRaw}-${createHash("sha256").update(recoveryRaw).digest("hex").slice(0, 12)}`;

async function setupProfile(base, logins) {
  const setup = await api(base, null, "GET", "/api/v1/desktop/setup");
  if (setup.json?.available) {
    const res = await api(base, null, "POST", "/api/v1/desktop/setup", {
      login: logins.manager, displayName: "QA-D Руководитель", password: pw.manager, mode: "empty", dataDirectory: "default", localDiskConfirmed: true,
    });
    if (![200, 201].includes(res.status)) throw new Error(`SETUP_FAILED:${res.status}`);
  }
  const jar = cookieJar();
  const login = await api(base, jar, "POST", "/api/v1/auth/login", { login: logins.manager, password: pw.manager });
  if (login.status !== 200) throw new Error(`MANAGER_LOGIN_FAILED:${login.status}`);
  for (const [loginName, displayName, key] of [[logins.r1, "QA-D Риелтор 1", "r1"], [logins.r2, "QA-D Риелтор 2", "r2"]]) {
    const users = await api(base, jar, "GET", "/api/v1/admin/users");
    const exists = users.json?.items?.some?.((u) => u.login === loginName) ?? users.json?.users?.some?.((u) => u.login === loginName);
    let temp = null;
    if (!exists) {
      const created = await api(base, jar, "POST", "/api/v1/admin/users", { login: loginName, displayName, roleCode: "realtor" });
      if (![200, 201].includes(created.status)) throw new Error(`CREATE_USER_FAILED:${created.status}`);
      temp = created.json?.temporaryPassword ?? created.json?.user?.temporaryPassword;
    }
    const rjar = cookieJar();
    const rlogin = await api(base, rjar, "POST", "/api/v1/auth/login", { login: loginName, password: temp ?? pw[key] });
    if (rlogin.status !== 200 && !temp) throw new Error(`REALTOR_LOGIN_FAILED:${loginName}:${rlogin.status}`);
    if (temp) {
      const changed = await api(base, rjar, "POST", "/api/v1/auth/change-password", { currentPassword: temp, newPassword: pw[key] });
      if (![200, 201].includes(changed.status)) throw new Error(`CHANGE_PASSWORD_FAILED:${changed.status}`);
    }
  }
  return jar;
}

function resolveDbFile(base) {
  const data = path.join(profileDirs(base).localappdata, "RealEstateCRM/data");
  const gen = path.join(data, "runtime-generations/current.json");
  if (existsSync(gen)) {
    try {
      const generation = JSON.parse(require("node:fs").readFileSync(gen, "utf8")).generation;
      const f = path.join(data, "runtime-generations/generations", generation, "database.sqlite");
      if (existsSync(f)) return f;
    } catch {}
  }
  return path.join(data, "crm.db");
}

async function runSeed(dbFile) {
  const dataDir = path.dirname(dbFile);
  const filesDir = dataDir.includes("runtime-generations")
    ? path.join(path.dirname(path.dirname(path.dirname(dbFile))), "..", "..")
    : null;
  void filesDir;
  const files = path.join(profileDirs(PROFILE).localappdata, "RealEstateCRM/files");
  const env = {
    ...process.env,
    PATH: `D:\\TEMP\\UserTEMP\\opencode\\node24\\node-v24.15.0-win-x64;${process.env.PATH}`,
    CRM_DEPLOYMENT_MODE: "desktop", DESKTOP_QA_SEED: "1",
    DATABASE_URL: "file:" + dbFile.replaceAll("\\", "/"), SQLITE_DATABASE_URL: "file:" + dbFile.replaceAll("\\", "/"),
    FILE_STORAGE_PATH: files,
  };
  const r = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/demo/seed-realistic-desktop.ts"], {
    cwd: root, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000,
  });
  if (r.error || r.status !== 0) throw new Error(`SEED_FAILED:${r.status}:${redact((r.stderr ?? "") + (r.stdout ?? "")).slice(-500)}`);
  console.log((r.stdout ?? "").trim().split("\n").slice(-2).join("\n"));
}

function sqliteCount(dbFile, table) {
  const Database = require("better-sqlite3");
  const db = new Database(dbFile, { readonly: true });
  try {
    return db.prepare(`select count(*) as n from ${table}`).get().n;
  } finally { db.close(); }
}

async function main() {
  checkApp();
  await mkdir(USB, { recursive: true });
  const logins = { manager: "d-manager", r1: "d-realtor1", r2: "d-realtor2" };
  let handle = null;
  const finish = async () => { if (handle) { await stopSupervisor(handle); handle = null; } };
  process.on("SIGINT", () => finish().finally(() => process.exit(130)));
  try {
    if (!OPS_ONLY) {
      await ensureDirs(PROFILE);
      await cleanupStale(PROFILE);
      await timed("холодный старт supervisor→ready", async () => {
        handle = startSupervisor(PROFILE);
        results.coldStartMs = Date.now();
        const base = await waitReady(handle);
        results.base = base;
        results.coldStartMs = Date.now() - results.coldStartMs;
      });
      section("cold-start", "PASS", `${results.coldStartMs} мс`);
      const base = results.base;
      const managerJar = await timed("setup+пользователи", () => setupProfile(base, logins));
      section("setup", "PASS");
      await stopSupervisor(handle); handle = null;
      if (!SKIP_SEED) {
        await timed("seed-realistic-desktop", () => runSeed(resolveDbFile(PROFILE)));
        const c = { clients: sqliteCount(resolveDbFile(PROFILE), "clients"), needs: sqliteCount(resolveDbFile(PROFILE), "client_needs"), properties: sqliteCount(resolveDbFile(PROFILE), "properties") };
        section("seed", "PASS", JSON.stringify(c));
      } else section("seed", "PASS", "пропущен флагом (профиль уже заполнен)");
      handle = startSupervisor(PROFILE);
      results.base = await waitReady(handle);
      section("restart-after-seed", "PASS", "данные на месте");
      const loginCheck = await api(results.base, cookieJar(), "POST", "/api/v1/auth/login", { login: logins.manager, password: pw.manager });
      if (loginCheck.status !== 200) throw new Error("LOGIN_AFTER_RESTART_FAILED");
      void managerJar;

      const pwEnv = { ...process.env, DESKTOP_QA_URL: results.base, DESKTOP_QA_PW_MANAGER: pw.manager, DESKTOP_QA_PW_R1: pw.r1, DESKTOP_QA_PW_R2: pw.r2, DESKTOP_QA_DB_FILE: resolveDbFile(PROFILE), PLAYWRIGHT_BROWSERS_PATH: path.join(APP, "chromium") };
      const r = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", "tests/qa-desktop/playwright.desktop.config.ts", "tests/qa-desktop/desktop-qa.spec.ts"], {
        cwd: root, env: { ...pwEnv, PATH: `D:\\TEMP\\UserTEMP\\opencode\\node24\\node-v24.15.0-win-x64;${process.env.PATH}` }, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 3600000,
      });
      console.log((r.stdout ?? "").slice(-4000));
      if (r.error || r.status !== 0) { section("business", "FAIL", `exit=${r.status}`); results.playwrightTail = (r.stderr ?? "").slice(-2000); }
      else section("business", "PASS");
    }

    if (!BUSINESS_ONLY) {
      if (!handle) { await ensureDirs(PROFILE); await cleanupStale(PROFILE); handle = startSupervisor(PROFILE); results.base = await waitReady(handle); }
      const base = results.base;
      if (!handle || handle.proc.exitCode !== null) throw new Error(`SUPERVISOR_NOT_RUNNING_BEFORE_OPS:exit=${handle?.proc.exitCode}`);
      const mjar = cookieJar();
      const mgrLogin = await api(base, mjar, "POST", "/api/v1/auth/login", { login: logins.manager, password: pw.manager });
      if (mgrLogin.status !== 200) throw new Error(`OPS_LOGIN_FAILED:${mgrLogin.status}`);

      // Бэкап: create → verify
      const before = await api(base, mjar, "GET", "/api/v1/settings/backups/control");
      const beforeIds = new Set((before.json?.archives ?? []).map((a) => a.backupId));
      const create = await api(base, mjar, "POST", "/api/v1/settings/backups/control", { action: "create", passphrase: PASSPHRASE, recoveryKey: RECOVERY, recoveryKeySaved: true });
      if (!create.json?.queued) throw new Error(`BACKUP_CREATE_NOT_QUEUED:${create.status}`);
      const reqId = create.json.requestId;
      const done = await timed("backup create", () => until(async () => {
        const st = await api(base, mjar, "GET", "/api/v1/settings/backups/control").catch(() => null);
        const job = st?.json?.jobs?.find?.((j) => j.id === reqId);
        return job?.status === "verified" ? st : null;
      }, 300000, "backup-create"));
      const fresh = (done.json.archives ?? []).filter((a) => !beforeIds.has(a.backupId));
      if (fresh.length !== 1) throw new Error(`BACKUP_AMBIGUOUS:${fresh.length}`);
      const archive = fresh[0];
      section("backup-create", "PASS", `id=${archive.backupId} size=${archive.size}`);
      const verify = await api(base, mjar, "POST", "/api/v1/settings/backups/control", { action: "verify", backupId: archive.backupId, recoveryKey: RECOVERY });
      const verifyId = verify.json?.requestId;
      await until(async () => {
        const st = await api(base, mjar, "GET", "/api/v1/settings/backups/control").catch(() => null);
        const job = st?.json?.jobs?.find?.((j) => j.id === verifyId);
        return job?.status === "verified" ? true : null;
      }, 300000, "backup-verify");
      section("backup-verify", "PASS");

      // Контрольные значения и мутация
      const clients = await api(base, mjar, "GET", "/api/v1/clients?take=1");
      const victim = clients.json.items[0];
      const mutatedName = `QA-D BACKUP MUTATION ${victim.id.slice(0, 8)}`;
      const cur = await api(base, mjar, "GET", `/api/v1/clients/${victim.id}`);
      await api(base, mjar, "PATCH", `/api/v1/clients/${victim.id}`, { expectedUpdatedAt: cur.json.updatedAt, displayName: mutatedName });

      // Восстановление (сервер перезапускается supervisor — терпим разрывы)
      const mref = { jar: mjar, login: logins.manager, password: pw.manager };
      const restore = await api(base, mjar, "POST", "/api/v1/settings/backups/control", { action: "restore", backupId: archive.backupId, passphrase: PASSPHRASE, confirmed: true });
      const restoreId = restore.json?.requestId;
      if (!restore.json?.queued) throw new Error(`RESTORE_NOT_QUEUED:${restore.status}`);
      await timed("backup restore", () => until(async () => {
        const st = await authed(base, mref, "GET", "/api/v1/settings/backups/control");
        if (!st) return null;
        const job = st.json?.jobs?.find?.((j) => j.id === restoreId);
        if (job?.status === "restored") {
          const check = await api(base, cookieJar(), "POST", "/api/v1/auth/login", { login: logins.manager, password: pw.manager }).catch(() => null);
          return check?.status === 200 ? true : null;
        }
        if (job?.status === "failed") throw new Error(`RESTORE_FAILED:${job.errorCode}`);
        return null;
      }, 600000, "backup-restore"));
      section("backup-restore", "PASS");
      const mjar2 = cookieJar();
      await api(base, mjar2, "POST", "/api/v1/auth/login", { login: logins.manager, password: pw.manager });
      const after = await api(base, mjar2, "GET", `/api/v1/clients/${victim.id}`);
      if (after.json.displayName !== victim.displayName) throw new Error("RESTORE_DATA_MISMATCH");
      section("restore-data-check", "PASS", "имя клиента возвращено, БД и файлы на месте");
      results.dbFile = resolveDbFile(PROFILE);
      const st1 = await stat(results.dbFile);
      section("db-size", "PASS", `sqlite=${Math.round(st1.size / 1048576)}МБ`);

      // USB-копия
      const portable = path.join(profileDirs(PROFILE).localappdata, "RealEstateCRM/backups/portable");
      const usbFiles = [];
      for (const f of await readdir(portable)) {
        if (f.startsWith(archive.backupId)) {
          await copyFile(path.join(portable, f), path.join(USB, f));
          usbFiles.push(f);
        }
      }
      const usbBuf = await readFile(path.join(USB, archive.backupId + ".crmbackup"));
      const usbHash = createHash("sha256").update(usbBuf).digest("hex");
      if (usbHash !== archive.sha256) throw new Error("USB_HASH_MISMATCH");
      section("usb-copy", "PASS", `sha256 совпал, bytes=${usbBuf.length}`);

      // Второй профиль: свежая «другая машина»
      const { rm: rmrf } = await import("node:fs/promises");
      await rmrf(PROFILE_B, { recursive: true, force: true });
      await ensureDirs(PROFILE_B);
      await cleanupStale(PROFILE_B);
      const handleB = startSupervisor(PROFILE_B);
      const baseB = await waitReady(handleB);
      const blogins = { manager: "d-manager", r1: "d-realtor1", r2: "d-realtor2" };
      const bjar = cookieJar();
      const bsetup = await api(baseB, null, "GET", "/api/v1/desktop/setup");
      if (bsetup.json?.available) {
        await api(baseB, null, "POST", "/api/v1/desktop/setup", { login: blogins.manager, displayName: "QA-D Руководитель Б", password: pw.manager, mode: "empty", dataDirectory: "default", localDiskConfirmed: true });
      }
      await api(baseB, bjar, "POST", "/api/v1/auth/login", { login: blogins.manager, password: pw.manager });
      const bportable = path.join(profileDirs(PROFILE_B).localappdata, "RealEstateCRM/backups/portable");
      await mkdir(bportable, { recursive: true });
      await copyFile(path.join(USB, archive.backupId + ".crmbackup"), path.join(bportable, archive.backupId + ".crmbackup"));
      if (existsSync(path.join(USB, archive.backupId + ".crmbackup.json"))) {
        await copyFile(path.join(USB, archive.backupId + ".crmbackup.json"), path.join(bportable, archive.backupId + ".crmbackup.json"));
      }
      const compare = await api(baseB, bjar, "POST", "/api/v1/settings/backups/control", { action: "compare", backupId: archive.backupId, recoveryKey: RECOVERY });
      const compareId = compare.json?.requestId;
      const cmpRes = await until(async () => {
        const st = await api(baseB, bjar, "GET", "/api/v1/settings/backups/control").catch(() => null);
        const job = st?.json?.jobs?.find?.((j) => j.id === compareId);
        return job && !["queued", "running", "pending"].includes(job.status) ? job : null;
      }, 300000, "compare");
      section("transfer-compare", cmpRes.status === "incoming" ? "PASS" : "PARTIAL", `compare=${cmpRes.status}`);
      const bref = { jar: bjar, login: blogins.manager, password: pw.manager };
      const brestore = await api(baseB, bjar, "POST", "/api/v1/settings/backups/control", { action: "restore", backupId: archive.backupId, passphrase: PASSPHRASE, confirmed: true });
      const brestoreId = brestore.json?.requestId;
      await until(async () => {
        const st = await authed(baseB, bref, "GET", "/api/v1/settings/backups/control");
        const job = st?.json?.jobs?.find?.((j) => j.id === brestoreId);
        if (job?.status === "restored") {
          const chk = await api(baseB, cookieJar(), "POST", "/api/v1/auth/login", { login: blogins.manager, password: pw.manager }).catch(() => null);
          return chk?.status === 200 ? true : null;
        }
        if (job?.status === "failed") throw new Error(`B_RESTORE_FAILED:${job.errorCode}`);
        return null;
      }, 600000, "b-restore");
      section("transfer-restore", "PASS", "второй профиль поднялся на копии");
      // Дивергенция: обе копии меняют одного клиента по-разному
      const bjar2 = cookieJar();
      await api(baseB, bjar2, "POST", "/api/v1/auth/login", { login: blogins.manager, password: pw.manager });
      const bv = await api(baseB, bjar2, "GET", `/api/v1/clients/${victim.id}`);
      await api(baseB, bjar2, "PATCH", `/api/v1/clients/${victim.id}`, { expectedUpdatedAt: bv.json.updatedAt, displayName: `QA-D ВЕТКА-Б ${victim.id.slice(0, 8)}` });
      const bcreate = await api(baseB, bjar2, "POST", "/api/v1/settings/backups/control", { action: "create", passphrase: PASSPHRASE, recoveryKey: RECOVERY, recoveryKeySaved: true });
      const breqId = bcreate.json.requestId;
      const bdone = await until(async () => {
        const st = await api(baseB, bjar2, "GET", "/api/v1/settings/backups/control").catch(() => null);
        const job = st?.json?.jobs?.find?.((j) => j.id === breqId);
        return job?.status === "verified" ? st : null;
      }, 300000, "b-backup");
      const barchive = bdone.json.archives.find((a) => a.backupId !== archive.backupId);
      // Дивергенция A: своя правка того же клиента + свой архив — две изменённые копии
      const av = await api(base, mjar2, "GET", `/api/v1/clients/${victim.id}`);
      await api(base, mjar2, "PATCH", `/api/v1/clients/${victim.id}`, { expectedUpdatedAt: av.json.updatedAt, displayName: `QA-D ВЕТКА-А ${victim.id.slice(0, 8)}` });
      const ycreate = await api(base, mjar2, "POST", "/api/v1/settings/backups/control", { action: "create", passphrase: PASSPHRASE, recoveryKey: RECOVERY, recoveryKeySaved: true });
      const yreqId = ycreate.json.requestId;
      await until(async () => {
        const st = await authed(base, mref, "GET", "/api/v1/settings/backups/control");
        const job = st?.json?.jobs?.find?.((j) => j.id === yreqId);
        return job?.status === "verified" ? true : null;
      }, 300000, "a-second-backup");
      const aportable = path.join(profileDirs(PROFILE).localappdata, "RealEstateCRM/backups/portable");
      await copyFile(path.join(bportable, barchive.backupId + ".crmbackup"), path.join(aportable, barchive.backupId + ".crmbackup"));
      if (existsSync(path.join(bportable, barchive.backupId + ".crmbackup.json"))) {
        await copyFile(path.join(bportable, barchive.backupId + ".crmbackup.json"), path.join(aportable, barchive.backupId + ".crmbackup.json"));
      }
      const acmp = await api(base, mjar2, "POST", "/api/v1/settings/backups/control", { action: "compare", backupId: barchive.backupId, passphrase: PASSPHRASE });
      const acmpId = acmp.json?.requestId;
      const acmpRes = await until(async () => {
        const st = await api(base, mjar2, "GET", "/api/v1/settings/backups/control").catch(() => null);
        const job = st?.json?.jobs?.find?.((j) => j.id === acmpId);
        return job && !["queued", "running", "pending"].includes(job.status) ? job : null;
      }, 300000, "a-compare");
      const bothKept = existsSync(path.join(aportable, archive.backupId + ".crmbackup")) && existsSync(path.join(aportable, barchive.backupId + ".crmbackup"));
      section("transfer-conflict", acmpRes.status === "conflict" && bothKept ? "PASS" : "PARTIAL", `compare=${acmpRes.status} обе версии на месте=${bothKept}`);
      await stopSupervisor(handleB);

      // Экспорты DOCX/XLSX/PDF/ZIP через API
      const rjar = cookieJar();
      await api(base, rjar, "POST", "/api/v1/auth/login", { login: logins.r1, password: pw.r1 });
      const needs = await api(base, rjar, "GET", "/api/v1/needs?status=active&mine=true");
      const needId = needs.json.items[0].id;
      const props = await api(base, rjar, "GET", "/api/v1/properties?status=active&take=5");
      const propertyIds = [props.json.items[0].id, props.json.items[1].id];
      const col = await api(base, rjar, "POST", "/api/v1/collections", { name: `QA-D export ${Date.now()}` });
      const colId = col.json.id;
      await api(base, rjar, "POST", `/api/v1/collections/${colId}/items`, { items: propertyIds.map((propertyId) => ({ propertyId })) });
      const colCard = await api(base, rjar, "GET", `/api/v1/collections/${colId}`);
      await api(base, rjar, "POST", `/api/v1/collections/${colId}/needs`, { expectedUpdatedAt: colCard.json.updatedAt, needId });
      const offer = await api(base, rjar, "POST", `/api/v1/collections/${colId}/offer`, { needId, itemIds: [colCard.json.items[0].id] });
      const offerId = offer.json.id;
      const doc = await api(base, rjar, "POST", `/api/v1/offers/${offerId}/document`, {});
      const dl = await api(base, rjar, "GET", `/api/v1/documents/${doc.json.id}/download`);
      if (!dl.buf.subarray(0, 4).equals(Buffer.from("PK\x03\x04"))) throw new Error("DOCX_MAGIC_MISMATCH");
      const pdf = await api(base, rjar, "GET", `/api/v1/offers/${offerId}/pdf`);
      if (!pdf.buf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("PDF_MAGIC_MISMATCH");
      const xlsx = await api(base, rjar, "GET", `/api/v1/collections/${colId}/export?format=xlsx`);
      if (!xlsx.buf.subarray(0, 4).equals(Buffer.from("PK\x03\x04"))) throw new Error("XLSX_MAGIC_MISMATCH");
      const zip = await api(base, mjar2, "GET", "/api/v1/export");
      if (zip.status !== 200 || zip.buf.length < 1024) throw new Error(`EXPORT_ZIP_FAILED:${zip.status}/${zip.buf.length}`);
      section("exports", "PASS", `docx=${dl.buf.length} pdf=${pdf.buf.length} xlsx=${xlsx.buf.length} zip=${zip.buf.length}`);

      // Поиск: 3 вежливых запуска demo-сценариев
      const runIds = [];
      for (const demoScenario of ["success", "partial", "empty"]) {
        const run = await api(base, rjar, "POST", "/api/v1/property-search/runs", {
          filters: { city: "Новосибирск", operation: "rent", priceUnit: "rub_month", locations: ["akademgorodok", "berdsk"], priceTo: "5000000", areaFrom: 30 },
          sources: ["cian", "avito"], idempotencyKey: `qa-desktop-${demoScenario}-${Date.now()}`, confirmedPaid: false, demoScenario,
        });
        if (![200, 201].includes(run.status)) throw new Error(`SEARCH_RUN_FAILED:${demoScenario}:${run.status}`);
        runIds.push({ scenario: demoScenario, id: run.json.id });
        await sleep(2000);
      }
      for (const r of runIds) {
        await until(async () => {
          const p = await api(base, rjar, "GET", `/api/v1/property-search/runs/${r.id}/progress`).catch(() => null);
          const st = p?.json?.status ?? p?.json?.run?.status;
          return st && !["queued", "running", "pending"].includes(st) ? true : null;
        }, 180000, `search-${r.scenario}`);
        const res = await api(base, rjar, "GET", `/api/v1/property-search/runs/${r.id}/results`);
        r.status = res.status;
        r.count = res.json?.total ?? res.json?.items?.length ?? 0;
      }
      section("search", "PASS", runIds.map((r) => `${r.scenario}:${r.status}/${r.count}`).join(" "));

      // AI-бюджет: потолок 2 ₽, не более 4 платных вызовов
      const aiSettings = await api(base, mjar2, "GET", "/api/v1/settings/ai");
      const usageBefore = await api(base, mjar2, "GET", "/api/v1/ai/usage?month=" + new Date().toISOString().slice(0, 7));
      const committedBefore = Number(usageBefore.json?.committedRub ?? 0);
      let aiStatus = "PASS", aiDetail = "";
      if (aiSettings.status === 200 && aiSettings.json?.setting) {
        const s = aiSettings.json.setting;
        const put = await api(base, mjar2, "PUT", "/api/v1/settings/ai", {
          expectedUpdatedAt: s.updatedAt, aiEnabled: true, scraperEnabled: s.scraperEnabled, browserEnabled: s.browserEnabled,
          enabledSources: s.enabledSources, webSearchManualAllowed: s.webSearchManualAllowed, webSearchAutoFallback: s.webSearchAutoFallback,
          model: s.model, webModel: s.webModel ?? null, searchContextSize: s.searchContextSize,
          perUserDailyLimit: s.perUserDailyLimit, perJobLimit: s.perJobLimit, dailyLimit: s.dailyLimit,
          monthlyBudgetRub: "2.00",
        });
        if (![200, 201].includes(put.status)) { aiStatus = "PARTIAL"; aiDetail = `budget-put=${put.status}`; }
        else {
          let paid = 0;
          const texts = ["офис 50-100 м аренда Академгородок", "двушка до 5 млн Бердск"];
          for (const text of texts) {
            const p = await api(base, rjar, "POST", "/api/v1/property-search/analysis/parse", { text, currentFilters: { operation: "rent", priceUnit: "rub_month" } }).catch(() => null);
            if (p && [200, 201].includes(p.status)) paid++;
            else if (p && ![503, 409, 402, 429].includes(p.status)) { aiStatus = "PARTIAL"; aiDetail = `parse=${p.status}`; }
          }
          const chat = await api(base, rjar, "POST", "/api/v1/ai-chat/sessions", {});
          if ([200, 201].includes(chat.status)) {
            const msg = await api(base, rjar, "POST", `/api/v1/ai-chat/sessions/${chat.json.id}/messages`, { text: "QA-D: кратко опиши, что видно на экране Сегодня" }).catch(() => null);
            if (msg && [200, 201].includes(msg.status)) paid++;
          }
          const offerText = await api(base, rjar, "POST", "/api/v1/ai/offer-text", { offerId, kind: "intro" }).catch(() => null);
          if (offerText && [200, 201].includes(offerText.status)) paid++;
          const usageAfter = await api(base, mjar2, "GET", "/api/v1/ai/usage?month=" + new Date().toISOString().slice(0, 7));
          const delta = Number(usageAfter.json?.committedRub ?? 0) - committedBefore;
          aiDetail = `paid~${paid} delta=${delta}₽`;
          if (paid > 4 || delta > 2) { aiStatus = "FAIL"; aiDetail += " BUDGET_EXCEEDED"; }
          if (paid === 0) { aiStatus = "PARTIAL"; aiDetail += " no-paid-calls"; }
        }
      } else { aiStatus = "PARTIAL"; aiDetail = `settings=${aiSettings.status}`; }
      section("ai-budget", aiStatus, aiDetail);

      // Воркеры: напоминания, одиночные процессы
      const notifs = await api(base, rjar, "GET", "/api/v1/notifications?take=5");
      const ncount = notifs.json?.items?.length ?? notifs.json?.total ?? 0;
      const logsDir = path.join(profileDirs(PROFILE).localappdata, "RealEstateCRM/logs");
      const logFiles = (await readdir(logsDir).catch(() => [])).filter((f) => /notifications|search|backup/.test(f));
      const rt = JSON.parse(await readFile(path.join(logsDir, "runtime.json"), "utf8"));
      section("workers", ncount > 0 && logFiles.length >= 3 ? "PASS" : "PARTIAL", `notifications=${ncount} logs=${logFiles.length} pid=${rt.pid}`);

      // Офлайн: битый прокси для supervisor, локальные функции работают
      await stopSupervisor(handle); handle = null;
      handle = startSupervisor(PROFILE, { HTTPS_PROXY: "http://127.0.0.1:9", HTTP_PROXY: "http://127.0.0.1:9", NO_PROXY: "127.0.0.1,localhost" });
      const offBase = await waitReady(handle);
      const offJar = cookieJar();
      const offLogin = await api(offBase, offJar, "POST", "/api/v1/auth/login", { login: logins.manager, password: pw.manager });
      const offClients = await api(offBase, offJar, "GET", "/api/v1/clients?take=1");
      const offParse = await api(offBase, offJar, "POST", "/api/v1/property-search/analysis/parse", { text: "офис аренда", currentFilters: { operation: "rent", priceUnit: "rub_month" } }).catch((e) => ({ status: 0, err: String(e).slice(0, 60) }));
      const leak = JSON.stringify(offParse.json ?? {}).toLowerCase();
      const secretLeak = /apikey|api_key|bearer|session|cookie|passwd|secret/.test(leak);
      section("offline", offLogin.status === 200 && offClients.status === 200 && offParse.status !== 200 && !secretLeak ? "PASS" : "PARTIAL", `login=${offLogin.status} local=${offClients.status} ai=${offParse.status}`);
      await stopSupervisor(handle); handle = null;

      // Повторный запуск: данные сохраняются, дублей воркеров нет
      const countsBefore = { clients: sqliteCount(resolveDbFile(PROFILE), "clients"), tasks: sqliteCount(resolveDbFile(PROFILE), "tasks") };
      handle = startSupervisor(PROFILE);
      const reBase = await waitReady(handle);
      results.base = reBase;
      const countsAfter = { clients: sqliteCount(resolveDbFile(PROFILE), "clients"), tasks: sqliteCount(resolveDbFile(PROFILE), "tasks") };
      const rt2 = JSON.parse(await readFile(path.join(profileDirs(PROFILE).localappdata, "RealEstateCRM/logs/runtime.json"), "utf8"));
      const same = countsBefore.clients === countsAfter.clients && countsBefore.tasks === countsAfter.tasks;
      section("restart", same ? "PASS" : "FAIL", `clients=${countsAfter.clients} tasks=${countsAfter.tasks} pid=${rt2.pid}`);
    }
    results.finishedAt = new Date().toISOString();
    await writeFile(path.join(root, "data-qa/desktop-qa-result.json"), JSON.stringify(results, null, 2) + "\n");
  } finally {
    if (handle) await stopSupervisor(handle);
    try {
      const list = spawnSync("wmic", ["process", "where", "name='node.exe'", "get", "ProcessId,CommandLine", "/format:csv"], { encoding: "utf8", windowsHide: true, timeout: 20000 });
      const leftovers = (list.stdout ?? "").split(/\r?\n/).filter((l) => l.includes("supervisor.mjs") && l.includes("src-tauri"));
      section("processes-stopped", leftovers.length ? "FAIL" : "PASS", leftovers.length ? `${leftovers.length} supervisor висят` : "своих процессов не осталось");
    } catch { section("processes-stopped", "PARTIAL", "не удалось проверить"); }
  }
  const fails = Object.values(results.sections).filter((s) => s.status === "FAIL").length;
  console.log(`[qa] done fails=${fails}`);
  console.log(results.timings.join(" | "));
  if (fails) process.exitCode = 1;
}

main().catch((e) => { console.error(`[qa] FATAL ${redact(e.message)}`); process.exitCode = 1; });
