import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createReadStream } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import path from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import { z } from "zod";
import { BackupError, DEFAULT_LIMITS, archiveRefSchema, assertBackupId, type ArchiveRef, type BackupDestination } from "../domain/contracts";
import { canonical, protectedDir, safeRelative, sha256 } from "./fs";
import { assertArchive, receive, safeEndpoint, verifyDownload } from "./transfer";
const indexSchema = z.object({ status: z.literal("complete"), archive: archiveRefSchema, parts: z.array(z.object({ key: z.string(), size: z.number().int().positive().max(128 * 1024 ** 2), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(10000) }).strict();
export interface WebDavOptions {
  id: string; prefix: string; email: string; applicationPassword: string; workRoot: string;
  endpoint?: string; allowLocalHttp?: boolean; partBytes?: number; useMove?: boolean; timeoutMs?: number;
}
export class MailruWebDav implements BackupDestination {
  readonly id: string; private readonly endpoint: URL; private readonly prefix: string; private readonly partBytes: number;
  constructor(private readonly options: WebDavOptions) {
    this.id = options.id; this.endpoint = safeEndpoint(options.endpoint ?? "https://webdav.cloud.mail.ru", options.allowLocalHttp);
    this.prefix = safeRelative(options.prefix); this.partBytes = options.partBytes ?? 64 * 1024 ** 2;
    if (this.partBytes < 1 || this.partBytes > 128 * 1024 ** 2) throw new BackupError("WEBDAV_PART_SIZE");
  }
  private url(key: string) { return new URL(this.endpoint.pathname.replace(/\/$/, "") + "/" + safeRelative(key).split("/").map(encodeURIComponent).join("/"), this.endpoint.origin); }
  private key(suffix: string) { return this.prefix + "/" + suffix; }
  private async request(method: string, key: string, body?: string | Buffer, headers: Record<string, string> = {}, signal?: AbortSignal) {
    const replayable = ["GET", "PROPFIND", "MKCOL", "DELETE"].includes(method) || (method === "PUT" && headers["If-None-Match"] === "*" && body !== undefined);
    let uncertainPut = false;
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw new BackupError("UPLOAD_CANCELLED");
      const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 60000);
      let response: Response;
      try {
        response = await fetch(this.url(key), { method, body: body as BodyInit | undefined, redirect: "error", headers: { Authorization: "Basic " + Buffer.from(this.options.email + ":" + this.options.applicationPassword).toString("base64"), ...headers }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      } catch (error) {
        if (signal?.aborted) throw new BackupError("UPLOAD_CANCELLED");
        // Do not retry TLS, redirect, authentication or timeout failures. Each
        // replay is bounded and conditional PUT can never overwrite an object.
        const cause = error instanceof Error ? error.cause : undefined;
        const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
        if (!replayable || timeout.aborted || attempt >= 2 || !["ECONNRESET", "ECONNREFUSED", "EPIPE", "EAI_AGAIN", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"].includes(String(code))) throw new BackupError("WEBDAV_NETWORK");
        uncertainPut ||= method === "PUT";
        try { await delay(200 * 2 ** attempt, undefined, { signal }); }
        catch { throw new BackupError("UPLOAD_CANCELLED"); }
        continue;
      }
      // Callers never inspect error bodies (which may contain provider secrets).
      if (!response.ok) await response.body?.cancel();
      if (response.status === 412 && uncertainPut && body !== undefined) {
        if (await this.matches(key, body, signal)) return new Response(null, { status: 204 });
      }
      return response;
    }
  }
  private async matches(key: string, body: string | Buffer, signal?: AbortSignal) {
    const expected = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const r = await this.request("GET", key, undefined, {}, signal); this.check(r);
    if (!r.body) throw new BackupError("WEBDAV_BODY");
    const reader = r.body.getReader(); const hash = createHash("sha256"); let size = 0;
    try {
      for (;;) {
        if (signal?.aborted) throw new BackupError("UPLOAD_CANCELLED");
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.length; if (size > expected.length) return false;
        hash.update(chunk.value);
      }
      return size === expected.length && hash.digest("hex") === sha256(expected);
    } catch { throw new BackupError(signal?.aborted ? "UPLOAD_CANCELLED" : "WEBDAV_NETWORK"); }
    finally { await reader.cancel().catch(() => {}); }
  }
  private check(r: Response, allowed: number[] = []) { if (!r.ok && !allowed.includes(r.status)) throw new BackupError("WEBDAV_HTTP_" + r.status); }
  private async text(r: Response, limit = 8 * 1024 ** 2) {
    this.check(r); if (!r.body) throw new BackupError("WEBDAV_BODY"); const reader = r.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    try { for (;;) { const value = await reader.read(); if (value.done) break; size += value.value.length; if (size > limit) throw new BackupError("WEBDAV_INDEX_LIMIT"); chunks.push(value.value); } }
    catch (error) { if (error instanceof BackupError) throw error; throw new BackupError("WEBDAV_NETWORK"); }
    finally { await reader.cancel().catch(() => {}); } return Buffer.concat(chunks).toString("utf8");
  }
  private async folders(key: string, signal?: AbortSignal) {
    const parts = safeRelative(key).split("/");
    for (let i = 1; i <= parts.length; i++) { const r = await this.request("MKCOL", parts.slice(0, i).join("/"), undefined, {}, signal); this.check(r, [405]); await r.body?.cancel(); }
  }
  private indexKey(id: string) { return this.key(assertBackupId(id) + ".complete.json"); }
  private async index(id: string, signal?: AbortSignal) {
    const r = await this.request("GET", this.indexKey(id), undefined, {}, signal);
    if (r.status === 404) { await r.body?.cancel(); return null; }
    const index = indexSchema.parse(JSON.parse(await this.text(r)));
    if (index.archive.backupId !== id || index.archive.size > DEFAULT_LIMITS.archiveBytes) throw new BackupError("WEBDAV_INDEX");
    let sum = 0; const seen = new Set<string>();
    for (const part of index.parts) {
      safeRelative(part.key);
      const tail = part.key.slice((this.key(id) + "/").length);
      if (!part.key.startsWith(this.key(id) + "/") || !/^[a-f0-9-]{36}\/part-[0-9]+$/.test(tail) || seen.has(part.key)) throw new BackupError("WEBDAV_PART_PATH");
      seen.add(part.key); sum += part.size;
    }
    if (sum !== index.archive.size) throw new BackupError("WEBDAV_PART_LENGTH"); return index;
  }
  async put(archive: ArchiveRef, source: string, signal?: AbortSignal) {
    archiveRefSchema.parse(archive); await assertArchive(source, archive);
    if (archive.size > DEFAULT_LIMITS.archiveBytes || Math.ceil(archive.size / this.partBytes) > 10000) throw new BackupError("WEBDAV_SIZE_LIMIT");
    const existing = await this.index(archive.backupId, signal);
    if (existing) { if (existing.archive.sha256 !== archive.sha256 || existing.archive.size !== archive.size) throw new BackupError("IMMUTABLE_CONFLICT"); await this.verify(archive, signal); return; }
    const prefix = this.key(archive.backupId + "/" + randomUUID()); await this.folders(prefix, signal); await protectedDir(this.options.workRoot);
    const temp = await mkdtemp(path.join(this.options.workRoot, "dav-")); const parts: z.infer<typeof indexSchema>["parts"] = [];
    const h = await open(source, "r");
    try {
      for (let start = 0, n = 0; start < archive.size; start += this.partBytes, n++) {
        if (signal?.aborted) throw new BackupError("UPLOAD_CANCELLED"); const size = Math.min(this.partBytes, archive.size - start); const data = Buffer.alloc(size);
        let read = 0; while (read < size) { const r = await h.read(data, read, size - read, start + read); if (!r.bytesRead) throw new BackupError("SOURCE_TRUNCATED"); read += r.bytesRead; }
        const key = prefix + "/part-" + n; const pending = key + ".pending";
        const digest = sha256(data); const uploaded = await this.request("PUT", pending, data, { "If-None-Match": "*" }, signal); this.check(uploaded); await uploaded.body?.cancel();
        const verifyPart = async (remote: string, label: string) => {
          const r = await this.request("GET", remote, undefined, {}, signal); this.check(r);
          const file = path.join(temp, label); await receive(r.body, file, size, signal); await assertArchive(file, { size, sha256: digest }); await rm(file);
        };
        await verifyPart(pending, "pending");
        let moved = false;
        if (this.options.useMove !== false) {
          const r = await this.request("MOVE", pending, undefined, { Destination: this.url(key).href, Overwrite: "F" }, signal);
          if (r.ok) moved = true; else if (![405, 501].includes(r.status)) this.check(r); await r.body?.cancel();
        }
        if (!moved) { const r = await this.request("PUT", key, data, { "If-None-Match": "*" }, signal); this.check(r); await r.body?.cancel(); }
        await verifyPart(key, "final");
        const deleted = await this.request("DELETE", pending, undefined, {}, signal); this.check(deleted, [404]); await deleted.body?.cancel();
        parts.push({ key, size, sha256: digest });
      }
      const latest = await this.index(archive.backupId, signal);
      if (latest && latest.archive.sha256 !== archive.sha256) throw new BackupError("IMMUTABLE_CONFLICT");
      // Publication point. No LOCK, no assumption that MOVE is atomic.
      const r = await this.request("PUT", this.indexKey(archive.backupId), canonical({ status: "complete", archive, parts }), { "Content-Type": "application/json", "If-None-Match": "*" }, signal);
      if (r.status === 412) { await r.body?.cancel(); await this.verify(archive, signal); } else { this.check(r); await r.body?.cancel(); }
    } finally { await h.close(); await rm(temp, { recursive: true, force: true }); }
  }
  async list() {
    const r = await this.request("PROPFIND", this.prefix, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>', { Depth: "1", "Content-Type": "application/xml" });
    if (r.status === 404) { await r.body?.cancel(); return []; }
    const xml = await this.text(r); if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new BackupError("XML_ENTITY_FORBIDDEN");
    const doc = new DOMParser().parseFromString(xml, "application/xml"); const nodes = doc.getElementsByTagNameNS("*", "href"); const refs: ArchiveRef[] = [];
    const seen = new Set<string>();
    for (let n = 0; n < nodes.length; n++) {
      const href = new URL(nodes.item(n)!.textContent ?? "", this.endpoint);
      if (href.origin !== this.endpoint.origin) continue;
      const prefixPath = this.url(this.prefix).pathname + "/"; if (!href.pathname.startsWith(prefixPath)) continue;
      const name = decodeURIComponent(href.pathname.slice(prefixPath.length)); if (!name.endsWith(".complete.json")) continue;
      const id = name.slice(0, -14); if (seen.has(id) || !archiveRefSchema.shape.backupId.safeParse(id).success) continue;
      const index = await this.index(id); if (index) refs.push(index.archive); seen.add(id);
    }
    return refs;
  }
  async get(id: string, dest: string, signal?: AbortSignal) {
     const index = await this.index(assertBackupId(id), signal); if (!index) throw new BackupError("BACKUP_NOT_FOUND");
    await protectedDir(this.options.workRoot); const temp = await mkdtemp(path.join(this.options.workRoot, "dav-get-"));
    const out = await open(dest, "wx", 0o600);
    try {
      for (const [i, part] of index.parts.entries()) {
        const r = await this.request("GET", part.key, undefined, {}, signal); this.check(r);
        const file = path.join(temp, String(i)); await receive(r.body, file, part.size, signal); await assertArchive(file, part);
        for await (const chunk of createReadStream(file)) await out.writeFile(chunk);
        await rm(file);
      }
      await out.sync();
    } catch (e) { await out.close(); await rm(dest, { force: true }); throw e; }
    finally { await out.close(); await rm(temp, { recursive: true, force: true }); }
    await assertArchive(dest, index.archive);
  }
  async delete(id: string) {
    const index = await this.index(assertBackupId(id)); if (!index) return;
    const r = await this.request("DELETE", this.indexKey(id)); this.check(r, [404]); await r.body?.cancel();
    for (const part of index.parts) { const deleted = await this.request("DELETE", part.key); this.check(deleted, [404]); await deleted.body?.cancel(); }
  }
  async verify(archive: ArchiveRef, signal?: AbortSignal) { await verifyDownload(this, archive, this.options.workRoot, signal); }
}
