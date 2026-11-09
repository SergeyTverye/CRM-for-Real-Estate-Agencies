import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "dotenv";
import { Document, Packer, Paragraph } from "docx";

const root = process.argv[2] ?? process.cwd();
const clean = root.toLowerCase().includes("crm-clean-v31");
const temporary = !clean || process.argv.includes("--resume");
const env = parse(readFileSync(`${root}/.env`));
const project = clean ? "crmclean31" : "crm";
const url = `http://127.0.0.1:${env.APP_PORT || 8080}`;
let login = env.SEED_MANAGER_LOGIN || "manager";
let password = env.SEED_MANAGER_PASSWORD;
const dc = (...args) => {
  try {
    return execFileSync("docker", ["compose", "-p", project, "--project-directory", root, "--env-file", `${root}/.env`, "-f", `${root}/compose.yaml`, ...args], { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    throw new Error("Docker Compose QA operation failed; inspect container health locally");
  }
};
function assert(ok, message) { if (!ok) throw new Error(message); }
let cookie = "";
async function request(path, data, form) {
  const res = await fetch(url + path, { method: data || form ? "POST" : "GET", headers: { origin: url, ...(cookie ? { cookie } : {}), ...(data ? { "content-type": "application/json" } : {}) }, body: form ?? (data ? JSON.stringify(data) : undefined), redirect: "manual" });
  assert(res.ok, `${path}: HTTP ${res.status}`);
  return res;
}
if (temporary) {
  login = `ops_restore_${randomBytes(6).toString("hex")}`;
  password = randomBytes(30).toString("base64url");
  dc("exec", "-T", "-e", `OPS_RESTORE_TEST_LOGIN=${login}`, "-e", `OPS_RESTORE_TEST_PASSWORD=${password}`, "app", "node", "node_modules/tsx/dist/cli.mjs", "scripts/ops-restore-login.ts");
}
try {
  const res = await request("/api/v1/auth/login", { login, password });
  cookie = res.headers.get("set-cookie").split(";")[0];
  const auth = await res.json();
  if (clean && !temporary) {
    assert(auth.mustChangePassword === true, "clean seed must require password change");
    const newPassword = randomBytes(28).toString("base64url") + "Aa9";
    await request("/api/v1/auth/change-password", { currentPassword: password, newPassword });
    password = newPassword;
    const fresh = await request("/api/v1/auth/login", { login, password });
    cookie = fresh.headers.get("set-cookie").split(";")[0];
    assert((await fresh.json()).mustChangePassword === false, "password change persisted");
  }
  const pages = {};
  for (const path of ["/property-search", "/calendar", "/collections", "/templates", "/requests", "/clients"]) pages[path] = (await request(path)).status;
  const collection = await (await request("/api/v1/collections", { name: "[release synthetic] backup control" })).json();
  const manifest = "schemaVersion: 1\nentityKind: collection\nsources: [collection, user]\nfields:\n  - path: collection.name\n    label: Подборка\n    type: text\n    required: true\n";
  const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("Подборка: {{collection.name}}") ] }] }));
  const form = new FormData();
  for (const [k, v] of Object.entries({ code: `release_${Date.now()}`, name: "[release synthetic] DOCX backup control", format: "docx", manifestYaml: manifest })) form.set(k, v);
  form.set("file", new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), "release-control.docx");
  const template = await (await request("/api/v1/templates", undefined, form)).json();
  const generated = await (await request(`/api/v1/templates/${template.id}/generate`, { entityKind: "collection", entityId: collection.id, requestId: randomUUID() })).json();
  assert(generated.id, "generated document persisted");
  const state = { time: new Date().toISOString(), project, pages, forcedPasswordChange: clean && !temporary, template: true, generatedDocument: true };
  if (clean) {
    const run = await (await request("/api/v1/property-search/runs", { filters: { city: "Новосибирск", operation: "sale", purposes: ["office"], sources: ["cian"] }, sources: ["cian"], idempotencyKey: randomUUID() })).json();
    let progress;
    for (let i = 0; i < 60; i++) {
      progress = await (await request(`/api/v1/property-search/runs/${run.id}/progress`)).json();
      if (!["queued", "running"].includes(progress.status)) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert(progress.status === "completed" && progress.sources.every(s => s.status === "disabled"), "disabled scraper must complete");
    state.disabledSearch = "completed/disabled";
  }
  writeFileSync(`${root}/data/release-gate-smoke.json`, JSON.stringify(state, null, 2));
  console.log(JSON.stringify(state));
  const bashEnv = { ...process.env, RESTORE_TEST_LOGIN: login, RESTORE_TEST_PASSWORD: password, BACKUP_RETENTION_DAILY: "10000", RESTORE_TEST_PORT: clean ? "18032" : "18080" };
  delete bashEnv.MSYS_NO_PATHCONV;
  delete bashEnv.MSYS2_ARG_CONV_EXCL;
  for (const script of ["scripts/backup.sh", "scripts/restore-test.sh"]) {
    const output = execFileSync("D:/runtimes/Git/bin/bash.exe", ["--noprofile", "--norc", script, ...(script.includes("restore-test") ? ["--keep"] : [])], { cwd: root, env: bashEnv, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    console.log(output);
  }
} finally {
  if (cookie) await fetch(url + "/api/v1/auth/logout", { method: "POST", headers: { origin: url, cookie } }).catch(() => {});
  if (temporary) {
    dc("exec", "-T", "db", "psql", "-U", env.POSTGRES_USER, "-d", env.POSTGRES_DB, "-v", "ON_ERROR_STOP=1", "-c", `UPDATE users SET is_active=false WHERE login='${login}'; DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE login='${login}');`);
  }
}
