import http from "node:http";
import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { safeRequest, fetchExternalImage } from "@/shared/net/ssrf";

afterEach(() => vi.restoreAllMocks());
const resolve = async () => [{ address: "8.8.8.8", family: 4 }];
function mockResponse(data: string, headers: http.IncomingHttpHeaders = {}, status = 200) {
  return vi.spyOn(http, "request").mockImplementation(((_url: URL, _options: http.RequestOptions, callback: (response: http.IncomingMessage) => void) => {
    const req = new EventEmitter() as EventEmitter & { end(): void };
    req.end = () => {
      const res = new EventEmitter() as EventEmitter & { headers: http.IncomingHttpHeaders; statusCode: number; destroy(error: Error): void };
      res.headers = headers; res.statusCode = status;
      res.destroy = error => { res.emit("error", error); };
      callback(res as unknown as http.IncomingMessage);
      res.emit("data", Buffer.from(data)); res.emit("end");
    };
    return req as unknown as http.ClientRequest;
  }) as typeof http.request);
}
it("pins resolved DNS and returns HTML as inert bytes", async () => {
  const mock = mockResponse("<script>throw 'never run'</script>");
  const response = await safeRequest("http://example.com", { resolve });
  expect(response.data.toString()).toContain("<script>");
  const opts = mock.mock.calls[0]?.[1] as http.RequestOptions;
  expect(opts.family).toBe(4);
  const callback = vi.fn();
  (opts.lookup as (host: string, options: object, cb: typeof callback) => void)("example.com", {}, callback);
  expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
});
it("rejects oversized response", async () => {
  mockResponse("too large");
  await expect(safeRequest("http://example.com", { resolve, maxBytes: 2 })).rejects.toThrow("RESPONSE_TOO_LARGE");
});
it("revalidates redirected target before connection", async () => {
  const mock = mockResponse("", { location: "http://169.254.169.254/latest/meta-data" }, 302);
  await expect(safeRequest("http://example.com", { resolve })).rejects.toThrow("UNSAFE_ADDRESS");
  expect(mock).toHaveBeenCalledOnce();
});
it("limits redirects", async () => {
  const mock = mockResponse("", { location: "http://example.com/again" }, 302);
  await expect(safeRequest("http://example.com", { resolve, maxRedirects: 1 })).rejects.toThrow("UNSAFE_REDIRECT");
  expect(mock).toHaveBeenCalledTimes(2);
});
it("rejects HTML masquerading as image and accepts raster content type", async () => {
  mockResponse("<html>", { "content-type": "text/html" });
  await expect(fetchExternalImage("http://example.com/image", { resolve })).rejects.toThrow("INVALID_IMAGE_RESPONSE");
  vi.restoreAllMocks(); mockResponse("raster fixture", { "content-type": "image/webp" });
  await expect(fetchExternalImage("http://example.com/image", { resolve })).resolves.toBeInstanceOf(Buffer);
});
