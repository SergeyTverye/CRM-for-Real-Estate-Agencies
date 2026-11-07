import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const state = vi.hoisted(() => ({
  actor: null as null | { userId: string; role: string; mustChangePassword: boolean },
  standby: true,
  root: "",
  journal: vi.fn(),
  put: vi.fn(),
  native: vi.fn(), list: vi.fn(), importArchive: vi.fn(),
}));
vi.mock("@/modules/auth/application/session-service", () => ({ resolveSession: async () => state.actor }));
vi.mock("@/shared/config/env", () => ({ getConfig: () => ({ isReadOnlyInstance: state.standby }) }));
vi.mock("@/shared/logging/logger", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock("@/shared/db/client", () => ({ db: { backupQueueJournal: { create: state.journal } } }));
vi.mock("@/modules/operations/application/operations-service", () => ({ startManualBackup: vi.fn() }));
vi.mock("@/modules/desktop-backup/infrastructure/destinations-runtime", () => ({
  backupRuntimeRoot: () => state.root,
  runtimeCredentialStore: () => ({ put: state.put }),
  withBackupDestinations: async (work: (d: { list: typeof state.list }[]) => Promise<unknown>) => work([{ list: state.list }]),
}));
vi.mock("@/modules/desktop-backup/application/native-dialog", () => ({
  requestNativeDialog: state.native, readNativeDialog: state.native, importNativeArchive: state.importArchive, cleanupNativeImports: vi.fn(),
  withNativeArchiveBudget: async (_root: string, work: () => Promise<unknown>) => work(),
}));
import { POST } from "@/app/api/v1/settings/backups/control/route";
import { api, readJson } from "@/server/api-handler";
import { backupControlCommand } from "@/modules/desktop-backup/application/backup-control";

const host = "127.0.0.1:3511";
const manager = { userId: "synthetic-manager", role: "manager", mustChangePassword: false };
const original = { mode: process.env.CRM_DEPLOYMENT_MODE, supervised: process.env.CRM_DESKTOP_SUPERVISED_UPGRADE, port: process.env.CRM_DESKTOP_PORT, backup: process.env.BACKUP_PATH };
const receive = () => ({ action: "receive", backupId: randomUUID(), confirmed: true, passphrase: "synthetic return phrase" });
function request(body: unknown, origin: string | null = "http://" + host) {
  return new NextRequest("http://" + host + "/api/v1/settings/backups/control", {
    method: "POST", headers: { host, "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body),
  });
}
const ctx = () => ({ params: Promise.resolve({}) });
beforeEach(async () => {
  state.root = await mkdtemp(path.join(tmpdir(), "crm-return-handoff-guard-"));
  state.actor = manager; state.standby = true; state.journal.mockClear(); state.put.mockClear(); state.native.mockReset(); state.list.mockReset();
  process.env.CRM_DEPLOYMENT_MODE = "desktop"; process.env.CRM_DESKTOP_SUPERVISED_UPGRADE = "1";
  process.env.CRM_DESKTOP_PORT = "3511";
  process.env.BACKUP_PATH = state.root;
});
afterEach(async () => {
  await rm(state.root, { recursive: true, force: true });
  for (const [key, value] of [["CRM_DEPLOYMENT_MODE", original.mode], ["CRM_DESKTOP_SUPERVISED_UPGRADE", original.supervised], ["CRM_DESKTOP_PORT", original.port], ["BACKUP_PATH", original.backup]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
});
async function noPublication() { expect(state.put).not.toHaveBeenCalled(); expect(state.journal).not.toHaveBeenCalled(); expect(await readdir(state.root)).toEqual([]); }

describe("return-handoff HTTP + real application authorization (synthetic IO adapters)", () => {
  it("reproduces the old route's pre-handler rejection, then queues explicit receive through the actual route", async () => {
    const command = receive();
    const oldRoute = api({ access: "manager" }, async ({ actor, req }) => backupControlCommand(actor, await readJson(req)));
    const blocked = await oldRoute(request(command), ctx());
    expect(blocked.status).toBe(503); expect((await blocked.json()).error.code).toBe("INSTANCE_READ_ONLY");
    await noPublication();
    const accepted = await POST(request(command), ctx()); expect(accepted.status).toBe(200);
    const result = await accepted.json(); expect(result.queued).toBe(true);
    const mailbox = JSON.parse(await readFile(path.join(state.root, "commands", result.requestId + ".json"), "utf8"));
    expect(mailbox.command).toEqual({ action: "receive", backupId: command.backupId, confirmed: true });
    expect(mailbox.actorUserId).toBe(manager.userId); expect(mailbox).not.toHaveProperty("passphrase");
    expect(state.put).toHaveBeenCalledExactlyOnceWith(mailbox.secretRef, { passphrase: command.passphrase });
    expect(state.journal).toHaveBeenCalledTimes(1);
  });
  it.each([null, { ...manager, role: "realtor" }, { ...manager, mustChangePassword: true }])("rejects unauthorized actor %j", async actor => {
    state.actor = actor; expect((await POST(request(receive()), ctx())).status).toBe(actor ? 403 : 401); await noPublication();
  });
  it.each([null, "https://evil.invalid"])("keeps CSRF rejection for %s", async origin => {
    expect((await POST(request(receive(), origin), ctx())).status).toBe(403); await noPublication();
  });
  it.each(["create", "give", "restore", "restore-from-file", "retry", "probe", "pick-directory"])("never permits standby command %s", async action => {
    const id = randomUUID();
    const body = ["pick-directory", "pick-archive"].includes(action) ? { action }
      : action === "native-result" ? { action, requestId: id }
      : action === "native-export" ? { action, backupId: id }
      : ["probe", "list"].includes(action) ? { action, destinationId: id }
      : action === "retry" ? { action, destinationId: id, backupId: randomUUID() }
      : ["create", "give"].includes(action) ? { action, passphrase: "synthetic return phrase", recoveryKey: "synthetic", recoveryKeySaved: true }
      : action === "restore-from-file" ? { action, requestId: id, confirmed: true, passphrase: "synthetic return phrase" }
      : { ...receive(), action };
    const response = await POST(request(body), ctx()); expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("INSTANCE_READ_ONLY"); await noPublication();
  });
  it("permits only technical listing, native selection and inspection on standby", async () => {
    state.list.mockResolvedValue([]); state.native.mockResolvedValue({ requestId: randomUUID(), status: "selected" });
    expect((await POST(request({ action: "list", destinationId: randomUUID() }), ctx())).status).toBe(200);
    expect((await POST(request({ action: "pick-archive" }), ctx())).status).toBe(200);
    expect((await POST(request({ action: "native-result", requestId: randomUUID() }), ctx())).status).toBe(200);
    for (const action of ["verify", "compare"]) {
      expect((await POST(request({ action, backupId: randomUUID(), passphrase: "synthetic return phrase" }), ctx())).status).toBe(200);
    }
    expect(state.standby).toBe(true); expect(state.journal).toHaveBeenCalledTimes(2);
  });
  it("exports an existing archive and queues native file as receive, not rollback", async () => {
    const backupId = randomUUID(); await mkdir(path.join(state.root, "portable"));
    await writeFile(path.join(state.root, "portable", backupId + ".crmbackup"), "synthetic encrypted fixture");
    state.native.mockResolvedValue({ requestId: randomUUID() });
    expect((await POST(request({ action: "native-export", backupId }), ctx())).status).toBe(200);
    state.importArchive.mockImplementation(async (_id, _actor, _credential, _root, publish) => publish(backupId));
    const response = await POST(request({ action: "receive-from-file", requestId: randomUUID(), confirmed: true, passphrase: "synthetic return phrase" }), ctx());
    expect(response.status).toBe(200);
    const result = await response.json();
    const mailbox = JSON.parse(await readFile(path.join(state.root, "commands", result.requestId + ".json"), "utf8"));
    expect(mailbox.command).toEqual({ action: "receive", backupId, confirmed: true });
    expect(state.standby).toBe(true);
  });
  it.each([
    { confirmed: false }, { confirmed: undefined }, { passphrase: undefined }, { backupId: "../../outside" },
    { path: "D:/attacker.sqlite" }, { action: "promote" }, { restoreAction: "restore" },
  ])("rejects invalid or unconfirmed receive %j before publication", async change => {
    expect((await POST(request({ ...receive(), ...change }), ctx())).status).not.toBe(200); await noPublication();
  });
  it.each(["server", "unsupervised"])("does not permit standby receive in %s runtime", async mode => {
    if (mode === "server") process.env.CRM_DEPLOYMENT_MODE = "server"; else delete process.env.CRM_DESKTOP_SUPERVISED_UPGRADE;
    expect((await POST(request(receive()), ctx())).status).toBe(503); await noPublication();
  });
  it("ordinary mutation still fails in the unchanged global guard", async () => {
    const work = vi.fn(); const ordinary = api({ access: "manager" }, work);
    expect((await ordinary(request({}), ctx())).status).toBe(503); expect(work).not.toHaveBeenCalled(); await noPublication();
  });
  it("keeps active-mode compare available without widening the standby exception", async () => {
    state.standby = false;
    const command = { ...receive(), action: "compare" };
    const response = await POST(request(command), ctx()); expect(response.status).toBe(200);
    const result = await response.json();
    const mailbox = JSON.parse(await readFile(path.join(state.root, "commands", result.requestId + ".json"), "utf8"));
    expect(mailbox.command.action).toBe("compare");
  });
});
