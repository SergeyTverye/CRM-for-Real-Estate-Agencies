import { copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BackupError, type ArchiveRef, type BackupDestination } from "../../src/modules/desktop-backup/domain/contracts";
import { hashFile } from "../../src/modules/desktop-backup/infrastructure/fs";
import { moduleFailureDiagnostic, probeS3Anonymous, runModuleTransferRestore, safeModuleErrorCode, type CloudLiveSecrets } from "../../scripts/acceptance/cloud-module";

const syntheticSecrets: CloudLiveSecrets = {
  yandex: { bucket: "synthetic-bucket", accessKeyId: "synthetic-access", secretAccessKey: "synthetic-secret" },
  mailru: { email: "synthetic@example.invalid", applicationPassword: "synthetic-app-password" },
};

function memoryDestination(id: string, root: string): BackupDestination {
  const objects = new Map<string, { file: string; archive: ArchiveRef }>();
  return {
    id,
    async put(archive, source) {
      const target = path.join(root, `${id}-${archive.backupId}.blob`);
      await copyFile(source, target); objects.set(archive.backupId, { archive, file: target });
    },
    async list() { return [...objects.values()].map(value => value.archive); },
    async get(backupId, target) { const item = objects.get(backupId); if (!item) throw new Error("NOT_FOUND"); await copyFile(item.file, target); },
    async delete(backupId) { const item = objects.get(backupId); if (item) { await rm(item.file, { force: true }); objects.delete(backupId); } },
    async verify(archive) {
      const item = objects.get(archive.backupId); if (!item) throw new Error("NOT_FOUND");
      const actual = await hashFile(item.file); if (actual.size !== archive.size || actual.sha256 !== archive.sha256) throw new Error("HASH_MISMATCH");
    },
  };
}
describe("MODULE_TRANSFER_RESTORE synthetic exercise", () => {
  it("creates one synthetic archive, exercises both failure paths, reloads queues, downloads and restores twice", async () => {
    const result = await runModuleTransferRestore(syntheticSecrets, ({ root: runRoot }) => ({
      destinations: [memoryDestination("yandex", runRoot), memoryDestination("mailru", runRoot)],
      async probeS3Anonymous() { return { getStatus: 403, listStatus: 403 }; },
      dispose() {},
    }));
    expect(result.stage).toBe("MODULE_TRANSFER_RESTORE");
    expect(result.status).toBe("COMPLETED");
    expect(result.providers).toBe(2);
    expect(result.bytes).toBeGreaterThan(7 * 1024 ** 2);
    expect(result.s3Parts).toBeGreaterThan(1);
    expect(result.mailruChunks).toBeGreaterThan(1);
    expect(result.restoredInstances).toBe(2);
    expect(result.failureModes).toBe(2);
    expect(result.anonymousDenied).toBe(2);
    expect(result.hashesMatch).toBe(true);
  }, 120_000);

  it("retains the safe repeated-put code from inside the queue even when cleanup also fails", async () => {
    const failure = await runModuleTransferRestore(syntheticSecrets, ({ root }) => {
      const yandex = memoryDestination("yandex", root);
      const put = yandex.put;
      let puts = 0;
      yandex.put = async (...args) => {
        if (++puts === 2) throw new BackupError("IMMUTABLE_CONFLICT");
        await put(...args);
      };
      // The module must preserve SECOND_QUEUE/IMMUTABLE_CONFLICT over cleanup errors.
      yandex.delete = async () => { throw new BackupError("S3_CLEANUP_FAILED"); };
      return { destinations: [yandex, memoryDestination("mailru", root)], async probeS3Anonymous() { return { getStatus: 403, listStatus: 403 }; }, dispose() {} };
    }).catch(error => moduleFailureDiagnostic(error));
    expect(failure).toEqual({
      scope: "MODULE_TRANSFER_RESTORE", stage: "SECOND_QUEUE", status: "FAILED", code: "IMMUTABLE_CONFLICT", provider: "YANDEX",
      cleanupStatus: "FAILED", cleanupCode: "S3_CLEANUP_FAILED", cleanupProvider: "YANDEX",
    });
  });

  it("discards raw provider errors swallowed by the queue, including uppercase messages and names", async () => {
    const failure = await runModuleTransferRestore(syntheticSecrets, ({ root }) => {
      const mailru = memoryDestination("mailru", root);
      mailru.put = async () => { throw Object.assign(new Error("SYNTHETIC_SECRET_RESPONSE"), { name: "AWS_PROVIDER_NAME", code: "AWS_RESPONSE_CODE" }); };
      return { destinations: [memoryDestination("yandex", root), mailru], async probeS3Anonymous() { return { getStatus: 403, listStatus: 403 }; }, dispose() {} };
    }).catch(error => moduleFailureDiagnostic(error));
    expect(failure).toEqual({
      scope: "MODULE_TRANSFER_RESTORE", stage: "FIRST_QUEUE", status: "FAILED", code: "MODULE_OPERATION_FAILED", provider: "MAILRU",
      cleanupStatus: "COMPLETED", cleanupCode: "NONE", cleanupProvider: "NONE",
    });
  });

  it("distinguishes an anonymous-list denial failure after two completed SQLite restores", async () => {
    const failure = await runModuleTransferRestore(syntheticSecrets, ({ root }) => ({
      destinations: [memoryDestination("yandex", root), memoryDestination("mailru", root)],
      async probeS3Anonymous() { return { getStatus: 403, listStatus: 200 }; }, dispose() {},
    })).catch(error => moduleFailureDiagnostic(error));
    expect(failure).toMatchObject({ stage: "ANONYMOUS", code: "S3_ANONYMOUS_LIST_NOT_DENIED", provider: "YANDEX", cleanupStatus: "COMPLETED" });
  });

  it("reports CLEANUP when the transfers and restores succeed but remote deletion fails", async () => {
    const failure = await runModuleTransferRestore(syntheticSecrets, ({ root }) => {
      const yandex = memoryDestination("yandex", root);
      yandex.delete = async () => { throw new BackupError("S3_CLEANUP_FAILED"); };
      return { destinations: [yandex, memoryDestination("mailru", root)], async probeS3Anonymous() { return { getStatus: 403, listStatus: 403 }; }, dispose() {} };
    }).catch(error => moduleFailureDiagnostic(error));
    expect(failure).toEqual({
      scope: "MODULE_TRANSFER_RESTORE", stage: "CLEANUP", status: "FAILED", code: "S3_CLEANUP_FAILED", provider: "YANDEX",
      cleanupStatus: "FAILED", cleanupCode: "S3_CLEANUP_FAILED", cleanupProvider: "YANDEX",
    });
  });
});

describe("anonymous S3 requests and diagnostic boundary", () => {
  it("lists at the bucket root, gets the exact object, and sends no authentication", async () => {
    const archive = { backupId: "00000000-0000-4000-8000-000000000001", size: 1, sha256: "0".repeat(64), createdAtUtc: "2026-11-06T00:00:00.000Z" };
    const requests: { url: URL; options: RequestInit | undefined }[] = [];
    const result = await probeS3Anonymous({ bucket: "synthetic-bucket", prefix: "crm-synthetic-smoke/synthetic-run", archive }, async (url, options) => {
      requests.push({ url: new URL(String(url)), options });
      return new Response(null, { status: 403 });
    });
    expect(result).toEqual({ getStatus: 403, listStatus: 403 });
    expect(requests).toHaveLength(2);
    expect(requests[0]!.url.pathname).toBe(`/synthetic-bucket/crm-synthetic-smoke/synthetic-run/${archive.backupId}.crmbackup`);
    expect(requests[0]!.url.search).toBe("");
    expect(requests[1]!.url.pathname).toBe("/synthetic-bucket/");
    expect(requests[1]!.url.searchParams.get("list-type")).toBe("2");
    expect(requests[1]!.url.searchParams.get("prefix")).toBe("crm-synthetic-smoke/synthetic-run/");
    for (const request of requests) {
      expect(request.options?.headers).toBeUndefined();
      expect(request.options?.credentials).toBe("omit");
      expect(request.options?.redirect).toBe("error");
    }
  });

  it("accepts only a typed BackupError with an exact safe code; never forwards stack/message/name", () => {
    expect(safeModuleErrorCode(new BackupError("WEBDAV_HTTP_403"))).toBe("WEBDAV_HTTP_403");
    for (const error of [new BackupError("RAW_PROVIDER_VALUE\n"), new BackupError("unsafe/url"), new BackupError("A".repeat(81)), new Error("S3_UPLOAD_FAILED"), { code: "S3_UPLOAD_FAILED", name: "BackupError" }]) {
      expect(safeModuleErrorCode(error)).toBe("MODULE_OPERATION_FAILED");
      expect(moduleFailureDiagnostic(error)).toBeUndefined();
    }
  });
});
