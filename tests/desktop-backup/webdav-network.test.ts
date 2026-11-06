import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { MailruWebDav } from "../../src/modules/desktop-backup/infrastructure/mailru-webdav";
import { sha256 } from "../../src/modules/desktop-backup/infrastructure/fs";
import { ReplicationQueue } from "../../src/modules/desktop-backup/application/replication-queue";
import { LocalDir } from "../../src/modules/desktop-backup/infrastructure/local-destination";

const roots: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); vi.useRealTimers(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const disconnected = () => new TypeError("synthetic connection failure", { cause: { code: "ECONNRESET" } });
type Call = { method: string; key: string; init: RequestInit };
async function setup(bytes = 33) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dav-network-")); roots.push(root);
  const data = Buffer.alloc(bytes, 71); const source = path.join(root, "synthetic.archive"); await writeFile(source, data);
  const archive = { backupId: randomUUID(), size: data.length, sha256: sha256(data), createdAtUtc: new Date().toISOString() };
  const objects = new Map<string, Buffer>(); const calls: Call[] = []; const cancelled: number[] = [];
  let hook: ((call: Call) => Response | undefined | Promise<Response | undefined>) | undefined;
  const response = (status: number, body?: Buffer) => new Response(new ReadableStream({ start(c) { if (body) { c.enqueue(body); c.close(); } }, cancel() { cancelled.push(status); } }), { status });
  const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
    const call = { method: init.method!, key: url.pathname, init }; calls.push(call);
    expect(url.origin).toBe("https://synthetic.invalid"); expect(init.redirect).toBe("error");
    const override = await hook?.(call); if (override) return override;
    if (init.method === "GET") return objects.has(call.key) ? new Response(new Uint8Array(objects.get(call.key)!)) : response(404);
    if (init.method === "MKCOL") return response(405);
    if (init.method === "DELETE") { objects.delete(call.key); return response(200); }
    if (init.method === "PUT") {
      expect(init.headers).toMatchObject({ "If-None-Match": "*" });
      if (objects.has(call.key)) return response(412);
      objects.set(call.key, Buffer.from(init.body as string | Buffer)); return response(201);
    }
    throw new Error("unexpected synthetic method");
  });
  vi.stubGlobal("fetch", fetcher);
  const dav = new MailruWebDav({ id: "mailru", prefix: "synthetic", email: "fake@example.invalid", applicationPassword: "synthetic-only", endpoint: "https://synthetic.invalid", workRoot: root, partBytes: 1024 * 1024, useMove: false });
  return { root, data, source, archive, objects, calls, cancelled, response, fetcher, dav, setHook(fn: typeof hook) { hook = fn; } };
}
describe("WebDAV bounded network recovery (fake fetch only)", () => {
  it("replays transient GET/MKCOL/PUT failures, verifies 8 parts and publishes complete manifest last", async () => {
    const s = await setup(7 * 1024 ** 2 + 100); const failed = new Set<string>();
    s.setHook(c => { if (["GET", "MKCOL", "PUT"].includes(c.method) && !failed.has(c.method)) { failed.add(c.method); throw disconnected(); } return undefined; });
    await s.dav.put(s.archive, s.source);
    const writes = s.calls.filter(c => c.method === "PUT");
    expect(writes.at(-1)?.key).toBe("/synthetic/" + s.archive.backupId + ".complete.json");
    const manifest = JSON.parse(s.objects.get(writes.at(-1)!.key)!.toString());
    expect(manifest.parts).toHaveLength(8);
    for (const p of manifest.parts) expect(sha256(s.objects.get("/" + p.key)!)).toBe(p.sha256);
    expect(s.calls.at(-1)?.method).toBe("PUT");
    const out = path.join(s.root, "download"); await s.dav.get(s.archive.backupId, out); expect(await readFile(out)).toEqual(s.data);
    expect(s.cancelled).toContain(405); expect(s.cancelled).toContain(201);
  });
  it.each(["pending", "final", "manifest"])("recovers lost %s PUT response only after remote checksum verification", async target => {
    const s = await setup(); let lostKey: string | undefined;
    s.setHook(c => {
      const match = target === "pending" ? c.key.endsWith(".pending") : target === "manifest" ? c.key.endsWith(".complete.json") : /part-0$/.test(c.key);
      if (!lostKey && c.method === "PUT" && match) { lostKey = c.key; s.objects.set(c.key, Buffer.from(c.init.body as string | Buffer)); throw disconnected(); }
      return undefined;
    });
    await s.dav.put(s.archive, s.source);
    const attempts = s.calls.filter(c => c.key === lostKey);
    const firstPut = attempts.findIndex(c => c.method === "PUT");
    expect(attempts.slice(firstPut, firstPut + 3).map(c => c.method)).toEqual(["PUT", "PUT", "GET"]);
    expect(s.cancelled).toContain(412);
    expect([...s.objects.keys()].some(k => k.endsWith(".complete.json"))).toBe(true);
  });
  it.each([Buffer.alloc(33, 72), Buffer.alloc(34, 71)])("rejects lost PUT response when remote bytes differ", async corrupt => {
    const s = await setup(); let lost = false;
    s.setHook(c => { if (!lost && c.method === "PUT") { lost = true; s.objects.set(c.key, corrupt); throw disconnected(); } return undefined; });
    await expect(s.dav.put(s.archive, s.source)).rejects.toThrow("WEBDAV_HTTP_412");
    expect([...s.objects.keys()].some(k => k.endsWith(".complete.json"))).toBe(false);
  });
  it("does not accept an ordinary 412 as successful upload", async () => {
    const s = await setup(); s.setHook(c => c.method === "PUT" ? s.response(412) : undefined);
    await expect(s.dav.put(s.archive, s.source)).rejects.toThrow("WEBDAV_HTTP_412");
    expect(s.calls.filter(c => c.method === "PUT")).toHaveLength(1);
  });
  it("bounds persistent failures and still replicates to the next destination", async () => {
    const s = await setup(); s.setHook(() => { throw disconnected(); });
    const local = new LocalDir("other-cloud-stand-in", path.join(s.root, "other"));
    const queue = new ReplicationQueue(path.join(s.root, "queue"), [s.dav, local]); await queue.enqueue(s.archive, s.source);
    const result = await queue.pump(); expect(result.map(r => r.status)).toEqual(["failed", "verified"]); expect(s.calls).toHaveLength(3);
    await local.verify(s.archive);
  });
  it("bounds a repeatedly lost PUT response even if every attempt stored the bytes", async () => {
    const s = await setup();
    s.setHook(c => { if (c.method === "PUT") { s.objects.set(c.key, Buffer.from(c.init.body as string | Buffer)); throw disconnected(); } return undefined; });
    await expect(s.dav.put(s.archive, s.source)).rejects.toThrow(/^WEBDAV_NETWORK$/);
    expect(s.calls.filter(c => c.method === "PUT")).toHaveLength(3);
    expect([...s.objects.keys()].some(k => k.endsWith(".complete.json"))).toBe(false);
  });
  it("abort during backoff stops retries with a safe code", async () => {
    const s = await setup(); const abort = new AbortController();
    s.setHook(() => { setTimeout(() => abort.abort(), 10); throw disconnected(); });
    await expect(s.dav.put(s.archive, s.source, abort.signal)).rejects.toThrow("UPLOAD_CANCELLED"); expect(s.calls).toHaveLength(1);
  });
  it("pre-aborted operation never makes a request", async () => {
    const s = await setup(); await expect(s.dav.put(s.archive, s.source, AbortSignal.abort())).rejects.toThrow("UPLOAD_CANCELLED"); expect(s.calls).toHaveLength(0);
  });
  it("forwards abort to an in-flight request and never retries it", async () => {
    const s = await setup(); const abort = new AbortController();
    s.setHook(c => new Promise((_resolve, reject) => {
      c.init.signal!.addEventListener("abort", () => reject(disconnected()), { once: true });
      abort.abort();
    }));
    await expect(s.dav.put(s.archive, s.source, abort.signal)).rejects.toThrow("UPLOAD_CANCELLED"); expect(s.calls).toHaveLength(1);
  });
  it("does not turn a request timeout into three long attempts", async () => {
    const s = await setup();
    const dav = new MailruWebDav({ id: "timeout", prefix: "synthetic", email: "fake@example.invalid", applicationPassword: "synthetic", endpoint: "https://synthetic.invalid", workRoot: s.root, timeoutMs: 10 });
    s.setHook(c => new Promise((_resolve, reject) => { c.init.signal!.addEventListener("abort", () => reject(disconnected()), { once: true }); }));
    await expect(dav.put(s.archive, s.source)).rejects.toThrow(/^WEBDAV_NETWORK$/); expect(s.calls).toHaveLength(1);
  });
  it.each([401, 403, 429, 500, 503])("does not retry HTTP %i or leave error bodies alive", async status => {
    const s = await setup(); s.setHook(() => s.response(status));
    await expect(s.dav.put(s.archive, s.source)).rejects.toThrow("WEBDAV_HTTP_" + status); expect(s.calls).toHaveLength(1); expect(s.cancelled).toContain(status);
  });
  it.each(["CERT_HAS_EXPIRED", "UND_ERR_REQ_CONTENT_LENGTH_MISMATCH", "unknown"])("does not retry non-transient %s failures or expose details", async code => {
    const s = await setup(); s.setHook(() => { throw new TypeError("secret provider detail", { cause: { code } }); });
    await expect(s.dav.put(s.archive, s.source)).rejects.toThrow(/^WEBDAV_NETWORK$/); expect(s.calls).toHaveLength(1);
  });
});
