import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import type { Actor } from "@/modules/auth/domain/actor";
import { nativeDialogRoot, readNativeDialog, requestNativeDialog } from "@/modules/desktop-backup/application/native-dialog";

vi.mock("@/shared/db/client", () => ({ db: {} }));
vi.mock("@/shared/config/env", () => ({ getConfig: () => ({ isReadOnlyInstance: false }) }));
vi.mock("@/modules/operations/application/operations-service", () => ({ startManualBackup: vi.fn() }));
import { backupControlCommand } from "@/modules/desktop-backup/application/backup-control";

const managers = [0, 1].map(() => ({ userId: randomUUID(), role: "manager" }) as Actor);
let temp: string;
beforeEach(async () => {
  temp = await mkdtemp(path.join(os.tmpdir(), "native-dialog-actor-"));
  vi.stubEnv("BACKUP_SETTINGS_DIR", path.join(temp, "settings"));
  vi.stubEnv("BACKUP_PATH", path.join(temp, "backups"));
  vi.stubEnv("CRM_DEPLOYMENT_MODE", "desktop");
  vi.stubEnv("CRM_DESKTOP_SUPERVISED_UPGRADE", "1");
});
afterEach(async () => { vi.useRealTimers(); vi.unstubAllEnvs(); await rm(temp, { recursive: true, force: true }); });

describe("native dialog actor ownership", () => {
  it.each(["folder", "export", "import"] as const)("isolates %s pending and completed results between two managers", async kind => {
    for (const owner of managers) {
      const other = managers.find(m => m !== owner)!;
      const { requestId } = await requestNativeDialog(kind, undefined, owner.userId);
      expect(await readNativeDialog(requestId, owner.userId)).toEqual({ status: "pending" });
      await expect(backupControlCommand(other, { action: "native-result", requestId })).rejects.toThrow("Системный диалог недоступен");
      const directory = path.join(temp, "synthetic-selection");
      const status = kind === "export" ? "exported" : "selected";
      await writeFile(path.join(nativeDialogRoot(), requestId + ".result.json"), JSON.stringify({ status, directory,
        ...(kind === "import" ? { kind, actorUserId: owner.userId, expiresAt: Date.now() + 60000 } : {}) }), "utf8");
      await rm(path.join(nativeDialogRoot(), requestId + ".request.json"));
      await expect(backupControlCommand(other, { action: "native-result", requestId })).rejects.toThrow("Системный диалог недоступен");
      expect(await backupControlCommand(owner, { action: "native-result", requestId })).toEqual({ status, directory: kind === "folder" ? directory : undefined });
      await expect(readNativeDialog(requestId)).rejects.toThrow("Системный диалог недоступен");
    }
  });

  it.each(["folder", "export", "import"] as const)("fails closed with missing, malformed or mismatched %s ownership", async kind => {
    const owner = managers[0]!;
    const { requestId } = await requestNativeDialog(kind, undefined, owner.userId);
    const ownerFile = path.join(nativeDialogRoot(), requestId + ".owner.json");
    await writeFile(path.join(nativeDialogRoot(), requestId + ".result.json"), JSON.stringify({ status: "selected", directory: temp }), "utf8");
    for (const metadata of ["{}", "not-json", JSON.stringify({ kind, actorUserId: managers[1]!.userId })]) {
      await writeFile(ownerFile, metadata, "utf8");
      await expect(readNativeDialog(requestId, owner.userId)).rejects.toThrow("Системный диалог недоступен");
    }
    await rm(ownerFile);
    await expect(readNativeDialog(requestId, owner.userId)).rejects.toThrow("Системный диалог недоступен");
    await expect(readNativeDialog(randomUUID(), owner.userId)).rejects.toThrow("Системный диалог недоступен");
    await expect(requestNativeDialog(kind)).rejects.toThrow();
  });

  it("retains import result ownership, kind and expiry validation without exposing paths", async () => {
    const owner = managers[0]!;
    const { requestId } = await requestNativeDialog("import", undefined, owner.userId);
    const file = path.join(nativeDialogRoot(), requestId + ".result.json");
    const valid = { status: "selected", kind: "import", actorUserId: owner.userId, expiresAt: Date.now() + 60000, directory: temp, selectedPath: temp };
    for (const result of [{ ...valid, actorUserId: managers[1]!.userId }, { ...valid, actorUserId: undefined }, { ...valid, kind: undefined }, { ...valid, expiresAt: 0 }, { ...valid, expiresAt: undefined }]) {
      await writeFile(file, JSON.stringify(result), "utf8");
      await expect(readNativeDialog(requestId, owner.userId)).rejects.toThrow();
    }
    await writeFile(file, JSON.stringify(valid), "utf8");
    expect(await readNativeDialog(requestId, owner.userId)).toEqual({ status: "selected", directory: undefined });
  });
  it.each(["folder", "export"] as const)("rejects conflicting optional %s result ownership or kind", async kind => {
    const owner = managers[0]!;
    const { requestId } = await requestNativeDialog(kind, undefined, owner.userId);
    for (const result of [{ status: "selected", actorUserId: managers[1]!.userId }, { status: "selected", kind: "import" }]) {
      await writeFile(path.join(nativeDialogRoot(), requestId + ".result.json"), JSON.stringify({ ...result, directory: temp }), "utf8");
      await expect(readNativeDialog(requestId, owner.userId)).rejects.toThrow("Системный диалог недоступен");
    }
  });

  it("pick-directory application callsite records the authenticated manager", async () => {
    const owner = managers[0]!;
    const { requestId } = await backupControlCommand(owner, { action: "pick-directory" }) as { requestId: string };
    expect(JSON.parse(await readFile(path.join(nativeDialogRoot(), requestId + ".request.json"), "utf8"))).toMatchObject({ kind: "folder", actorUserId: owner.userId });
  });
  it("native-export application callsite records the authenticated manager", async () => {
    const owner = managers[0]!, backupId = randomUUID();
    const catalog = path.join(temp, "backups", "portable"); await mkdir(catalog, { recursive: true });
    await writeFile(path.join(catalog, backupId + ".crmbackup"), "synthetic-export-placeholder", "utf8");
    const { requestId } = await backupControlCommand(owner, { action: "native-export", backupId }) as { requestId: string };
    expect(JSON.parse(await readFile(path.join(nativeDialogRoot(), requestId + ".request.json"), "utf8"))).toMatchObject({ kind: "export", backupId, actorUserId: owner.userId });
  });
});

describe("native import post-picker role refresh", () => {
  it.each([false, true, "failure", "missing"] as const)("uses authoritative status, not stale role: %s", async standby => {
    const source = await readFile("src/app/(crm)/settings/backups/backup-panel.tsx", "utf8");
    const tree = ts.createSourceFile("backup-panel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let handler: ts.FunctionDeclaration | undefined;
    function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === "nativeDialog") handler = node; ts.forEachChild(node, visit); }
    visit(tree); expect(handler).toBeDefined();
    const js = ts.transpile(handler!.getText(tree), { target: ts.ScriptTarget.ES2022 });
    const openOperation = vi.fn(), setImportRequestId = vi.fn(), setStatus = vi.fn();
    const errors: unknown[] = [];
    const apiCall = vi.fn(async (method: string, _url: string, body?: { action: string }) => {
      if (method === "GET") {
        expect(openOperation).not.toHaveBeenCalled(); expect(setImportRequestId).not.toHaveBeenCalled();
        if (standby === "failure") throw Error("synthetic refresh failure");
        return standby === "missing" ? {} : { standby };
      }
      return body?.action === "native-result" ? { status: "selected" } : { requestId: "synthetic-request" };
    });
    const action = { run: async (work: () => Promise<unknown>) => { try { return await work(); } catch (e) { errors.push(e); } } };
    const nativeDialog = new Function("apiCall", "action", "base", "nativePending", "setNativePending", "setNotice", "setImportRequestId", "openOperation", "status", "destination", "setDestination", "setDirty", "setStatus", js + ";return nativeDialog;")(
      apiCall, action, "/synthetic", false, vi.fn(), vi.fn(), setImportRequestId, openOperation, { standby: !standby }, null, vi.fn(), vi.fn(), setStatus,
    ) as (kind: string) => Promise<void>;
    vi.useFakeTimers();
    const pending = nativeDialog("pick-archive");
    await vi.advanceTimersByTimeAsync(1000); await pending;
    expect(apiCall.mock.calls.map(c => c[0])).toEqual(["POST", "POST", "GET"]);
    if (typeof standby === "boolean") {
      expect(errors).toEqual([]); expect(setStatus).toHaveBeenCalledWith({ standby });
      expect(openOperation).toHaveBeenCalledExactlyOnceWith(standby ? "receive-from-file" : "restore-from-file");
    } else {
      expect(errors).toHaveLength(1); expect(openOperation).not.toHaveBeenCalled(); expect(setImportRequestId).not.toHaveBeenCalled();
    }
  });
});
