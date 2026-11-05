import https from "node:https";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import { guardExternalUrl, type SafeRequestOptions } from "@/shared/net/ssrf";

/** Sites may ignore Accept-Encoding: identity. Both wire and decoded sizes are bounded. */
export function decodeScraperBody(body: Buffer, encoding: string | undefined, maxBytes: number): Buffer {
  const decode = ({ gzip: gunzipSync, deflate: inflateSync, br: brotliDecompressSync } as const)[encoding?.toLowerCase() as "gzip" | "deflate" | "br"];
  if (encoding && encoding !== "identity" && !decode) throw new Error("UNSUPPORTED_CONTENT_ENCODING");
  const result = decode ? decode(body, { maxOutputLength: maxBytes }) : body;
  if (result.length > maxBytes) throw new Error("RESPONSE_TOO_LARGE");
  return result;
}

/** Same DNS validation/pinning as safeRequest; redirects stay with scraperHttpRequest. */
export async function compressedScraperRequest(raw: string, options: SafeRequestOptions = {}) {
  const controller = new AbortController(), abort = () => controller.abort();
  const timer = setTimeout(abort, options.timeoutMs ?? 30000);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  try {
    const { url, addresses } = await Promise.race([
      guardExternalUrl(raw, options.resolve),
      new Promise<never>((_, reject) => {
        if (controller.signal.aborted) reject(new Error("NETWORK_TIMEOUT_OR_ABORT"));
        else controller.signal.addEventListener("abort", () => reject(new Error("NETWORK_TIMEOUT_OR_ABORT")), { once: true });
      }),
    ]);
    if (url.protocol !== "https:") throw new Error("UNSAFE_SCRAPER_URL");
    const pinned = addresses[0]!, maxBytes = options.maxBytes ?? 10000000;
    return await new Promise<{ data: Buffer; status: number; url: string; headers: import("node:http").IncomingHttpHeaders }>((resolve, reject) => {
      const request = https.request(url, {
        method: options.method ?? "GET", agent: false, signal: controller.signal, family: pinned.family,
        headers: { ...Object.fromEntries(Object.entries(options.headers ?? {}).filter(([key]) => !["host", "accept-encoding"].includes(key.toLowerCase()))), "accept-encoding": "gzip, deflate, br" },
        lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
      }, response => {
        const chunks: Buffer[] = []; let length = 0;
        response.on("data", (chunk: Buffer) => { length += chunk.length; if (length > maxBytes) response.destroy(new Error("RESPONSE_TOO_LARGE")); else chunks.push(chunk); });
        response.on("error", reject);
        response.on("end", () => {
          try { resolve({ data: decodeScraperBody(Buffer.concat(chunks), response.headers["content-encoding"], maxBytes), status: response.statusCode ?? 0, headers: response.headers, url: url.href }); }
          catch (error) { reject(error); }
        });
      });
      request.on("error", error => reject(controller.signal.aborted ? new Error("NETWORK_TIMEOUT_OR_ABORT") : error));
      request.end(options.body);
    });
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
}
