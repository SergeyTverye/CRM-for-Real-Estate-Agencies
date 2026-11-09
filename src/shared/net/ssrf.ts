import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import http from "node:http";
import https from "node:https";

export type ResolveHost = (host: string) => Promise<{ address: string; family: number }[]>;
const blocked = new BlockList();
const blockedV6 = new BlockList();
for (const [ip, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16], ["192.0.0.0", 24], ["192.0.2.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) blocked.addSubnet(ip, prefix, "ipv4");
for (const [ip, prefix] of [["::", 96], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8]] as const) blockedV6.addSubnet(ip, prefix, "ipv6");
export function isPublicIp(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4") : family === 6 && !blockedV6.check(address, "ipv6");
}
export function parseExternalUrl(raw: string): URL {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("UNSAFE_URL");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if ((isIP(host) && !isPublicIp(host)) || /(?:^|\.)(?:localhost|local|internal)$/iu.test(host)) throw new Error("UNSAFE_ADDRESS");
  return url;
}
export async function guardExternalUrl(raw: string, resolve: ResolveHost = host => lookup(host, { all: true })): Promise<{ url: URL; addresses: { address: string; family: number }[] }> {
  const url = parseExternalUrl(raw);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolve(hostname);
  if (!addresses.length || addresses.some(a => !isPublicIp(a.address))) throw new Error("UNSAFE_ADDRESS");
  return { url, addresses };
}
export interface SafeRequestOptions {
  timeoutMs?: number; maxBytes?: number; maxRedirects?: number; signal?: AbortSignal;
  method?: "GET" | "POST"; headers?: Record<string, string>; body?: string; resolve?: ResolveHost; followRedirects?: boolean;
}
export async function safeRequest(raw: string, options: SafeRequestOptions = {}): Promise<{ data: Buffer; status: number; url: string; headers: http.IncomingHttpHeaders }> {
  const timeoutMs = options.timeoutMs ?? 15_000, maxBytes = options.maxBytes ?? 5_000_000;
  if (!(timeoutMs > 0) || !(maxBytes > 0)) throw new Error("INVALID_NETWORK_LIMIT");
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
    const execute = async (target: string, remaining: number): Promise<{ data: Buffer; status: number; url: string; headers: http.IncomingHttpHeaders }> => {
      const checked = await Promise.race([
        guardExternalUrl(target, options.resolve),
        new Promise<never>((_, reject) => { if (controller.signal.aborted) reject(new Error("NETWORK_TIMEOUT_OR_ABORT")); else controller.signal.addEventListener("abort", () => reject(new Error("NETWORK_TIMEOUT_OR_ABORT")), { once: true }); }),
      ]);
      const { url, addresses } = checked;
      const pinned = addresses[0]!;
      const response = await new Promise<{ data: Buffer; status: number; url: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
        const req = (url.protocol === "https:" ? https : http).request(url, {
          method: options.method ?? "GET", headers: { ...Object.fromEntries(Object.entries(options.headers ?? {}).filter(([key]) => !["host", "accept-encoding"].includes(key.toLowerCase()))), "accept-encoding": "identity" }, signal: controller.signal,
          agent: false,
          family: pinned.family,
          lookup: (_hostname, _opts, cb) => cb(null, pinned.address, pinned.family),
        }, res => {
          const chunks: Buffer[] = []; let bytes = 0;
          res.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > maxBytes) res.destroy(new Error("RESPONSE_TOO_LARGE")); else chunks.push(chunk); });
          res.on("error", reject);
          res.on("end", () => {
            if (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity") reject(new Error("UNSUPPORTED_CONTENT_ENCODING"));
            else resolve({ data: Buffer.concat(chunks), status: res.statusCode ?? 0, url: url.href, headers: res.headers });
          });
        });
        req.on("error", reject); req.end(options.body);
      });
      if (options.followRedirects !== false && [301, 302, 303, 307, 308].includes(response.status) && response.headers.location) {
        if (remaining <= 0 || options.method === "POST") throw new Error("UNSAFE_REDIRECT");
        return execute(new URL(response.headers.location, url).href, remaining - 1);
      }
      return response;
    };
    return await execute(raw, options.maxRedirects ?? 3);
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
}
export async function fetchExternalImage(url: string, options: SafeRequestOptions = {}): Promise<Buffer> {
  const response = await safeRequest(url, options);
  if (response.status !== 200 || !/^image\/(?:jpeg|png|webp|gif|avif)(?:;|$)/iu.test(String(response.headers["content-type"] ?? ""))) throw new Error("INVALID_IMAGE_RESPONSE");
  return response.data;
}
