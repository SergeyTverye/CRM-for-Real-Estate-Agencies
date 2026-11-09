import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { createReadStream } from "node:fs";
import { open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { BackupError, DEFAULT_LIMITS, archiveRefSchema, assertBackupId, type ArchiveRef, type BackupDestination } from "../domain/contracts";
import { atomicJson, canonical, protectedDir, safeRelative, sha256 } from "./fs";
import { assertArchive, receive, safeEndpoint, verifyDownload } from "./transfer";
export interface S3Options {
  id: string; bucket: string; prefix: string; workRoot: string;
  credentials: { accessKeyId: string; secretAccessKey: string };
  endpoint?: string; region?: string; allowLocalHttp?: boolean; partBytes?: number;
  requestHandler?: S3ClientConfig["requestHandler"];
}
export class YandexS3 implements BackupDestination {
  readonly id: string; readonly client: S3Client; private readonly prefix: string; private readonly partBytes: number;
  constructor(private readonly options: S3Options) {
    this.id = options.id; this.prefix = safeRelative(options.prefix); this.partBytes = options.partBytes ?? 16 * 1024 ** 2;
    if (this.partBytes < 5 * 1024 ** 2 || this.partBytes > 128 * 1024 ** 2) throw new BackupError("S3_PART_SIZE");
    safeEndpoint(options.endpoint ?? "https://storage.yandexcloud.net", options.allowLocalHttp);
    this.client = new S3Client({ endpoint: options.endpoint ?? "https://storage.yandexcloud.net", region: options.region ?? "ru-central1", credentials: options.credentials, forcePathStyle: true, maxAttempts: 2, requestHandler: options.requestHandler ?? { connectionTimeout: 5000, requestTimeout: 60000 }, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
  }
  private key(id: string) { return this.prefix + "/" + assertBackupId(id) + ".crmbackup"; }
  async put(archive: ArchiveRef, source: string, signal?: AbortSignal) {
    archiveRefSchema.parse(archive); await assertArchive(source, archive); await protectedDir(this.options.workRoot);
    if (archive.size > DEFAULT_LIMITS.archiveBytes || Math.ceil(archive.size / this.partBytes) > 10000) throw new BackupError("S3_SIZE_LIMIT");
    const Bucket = this.options.bucket, Key = this.key(archive.backupId);
    const journal = path.join(this.options.workRoot, "s3-" + sha256(this.options.bucket + "/" + this.prefix).slice(0, 16) + "-" + archive.backupId + ".json");
    try {
      const prior = JSON.parse(await readFile(journal, "utf8")) as { uploadId: string; key: string; bucket: string };
      if (prior.key === Key && prior.bucket === Bucket && typeof prior.uploadId === "string") await this.client.send(new AbortMultipartUploadCommand({ Bucket, Key, UploadId: prior.uploadId }));
      await rm(journal, { force: true });
    } catch (e) { const code = (e as { name?: string; code?: string }); if (code.code !== "ENOENT" && code.name !== "NoSuchUpload") throw e; await rm(journal, { force: true }); }
    try {
      if (archive.size <= this.partBytes) {
        await this.client.send(new PutObjectCommand({ Bucket, Key, Body: createReadStream(source), ContentLength: archive.size, IfNoneMatch: "*", Metadata: { sha256: archive.sha256, created: archive.createdAtUtc } }), { abortSignal: signal });
      } else {
        const result = await this.client.send(new CreateMultipartUploadCommand({ Bucket, Key, Metadata: { sha256: archive.sha256, created: archive.createdAtUtc } }), { abortSignal: signal });
        if (!result.UploadId) throw new BackupError("S3_UPLOAD_ID");
        const UploadId = result.UploadId;
        try {
          await atomicJson(journal, { uploadId: UploadId, key: Key, bucket: Bucket });
          const parts: { PartNumber: number; ETag: string }[] = []; const h = await open(source, "r");
          try {
            for (let start = 0, n = 1; start < archive.size; start += this.partBytes, n++) {
              signal?.throwIfAborted(); const length = Math.min(this.partBytes, archive.size - start); const bytes = Buffer.alloc(length);
              let read = 0; while (read < length) { const chunk = await h.read(bytes, read, length - read, start + read); if (!chunk.bytesRead) throw new BackupError("SOURCE_TRUNCATED"); read += chunk.bytesRead; }
              const part = await this.client.send(new UploadPartCommand({ Bucket, Key, UploadId, PartNumber: n, Body: bytes }), { abortSignal: signal });
              if (!part.ETag) throw new BackupError("S3_PART_ETAG"); parts.push({ PartNumber: n, ETag: part.ETag });
            }
          } finally { await h.close(); }
          await this.client.send(new CompleteMultipartUploadCommand({ Bucket, Key, UploadId, MultipartUpload: { Parts: parts }, IfNoneMatch: "*" }), { abortSignal: signal });
          await rm(journal, { force: true });
        } catch (e) {
          try { await this.client.send(new AbortMultipartUploadCommand({ Bucket, Key, UploadId })); await rm(journal, { force: true }); } catch {  }
          throw e;
        }
      }
    } catch (e) {
      if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412) { await this.verify(archive, signal); return; }
      throw new BackupError(signal?.aborted ? "UPLOAD_CANCELLED" : "S3_UPLOAD_FAILED");
    }
  }
  async list() {
    const out: ArchiveRef[] = []; let token: string | undefined;
    do {
      const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.options.bucket, Prefix: this.prefix + "/", ContinuationToken: token }));
      for (const item of r.Contents ?? []) {
        const suffix = item.Key?.slice(this.prefix.length + 1);
        if (!suffix?.endsWith(".crmbackup")) continue;
        const id = suffix.slice(0, -10); if (!archiveRefSchema.shape.backupId.safeParse(id).success) continue;
        const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
        const head = await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: item.Key }));
        const ref = archiveRefSchema.safeParse({ backupId: id, size: head.ContentLength, sha256: head.Metadata?.sha256, createdAtUtc: head.Metadata?.created });
        if (ref.success) out.push(ref.data);
      }
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return out;
  }
  async get(id: string, dest: string, signal?: AbortSignal) {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: this.key(id) }), { abortSignal: signal });
    await receive(result.Body?.transformToWebStream() ?? null, dest, DEFAULT_LIMITS.archiveBytes, signal);
  }
  async delete(id: string) { await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: this.key(id) })); }
  async verify(archive: ArchiveRef, signal?: AbortSignal) { await verifyDownload(this, archive, this.options.workRoot, signal); }
  async readOwnership(): Promise<{ value: unknown; etag: string } | null> {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: this.prefix + "/ownership.json" }));
      if (!r.ETag || (r.ContentLength ?? Infinity) > 8192) throw new BackupError("OWNERSHIP_INVALID");
      return { value: JSON.parse(await r.Body!.transformToString()), etag: r.ETag };
    } catch (e) { if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null; throw e; }
  }
  async compareAndSetOwnership(value: unknown, expectedEtag: string | null) {
    const body = canonical(value); if (Buffer.byteLength(body) > 8192) throw new BackupError("OWNERSHIP_INVALID");
    try { const r = await this.client.send(new PutObjectCommand({ Bucket: this.options.bucket, Key: this.prefix + "/ownership.json", Body: body, ContentType: "application/json", ...(expectedEtag ? { IfMatch: expectedEtag } : { IfNoneMatch: "*" }) })); return r.ETag!; }
    catch { throw new BackupError("OWNERSHIP_CONFLICT"); }
  }
  close() { this.client.destroy(); }
}
