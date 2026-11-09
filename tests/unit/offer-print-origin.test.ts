import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { offerPrintOrigin } from "@/modules/commercial-offers/application/offer-print-origin";
import { ForbiddenError } from "@/shared/errors";

describe("offer print origin", () => {
  const request = (port = "4273", method = "GET", extra: Record<string, string> = {}) => ({
    nextUrl: { origin: "http://localhost:4570" }, method,
    headers: new Headers({ host: `127.0.0.1:${port}`, ...(method === "POST" ? { origin: `http://127.0.0.1:${port}` } : {}), ...extra }),
  });
  const env = (port: string | undefined) => ({ CRM_DEPLOYMENT_MODE: "desktop", CRM_DESKTOP_PORT: port });

  it.each(["4273", "8027", "1", "65535"])("uses configured loopback port %s for GET and POST", port => {
    for (const method of ["GET", "POST"]) {
      expect(offerPrintOrigin(request(port, method), env(port))).toBe(`http://127.0.0.1:${port}`);
    }
  });
  it.each([undefined, "", "0", "65536", "-1", "4273.0", "4273/path", "4273@evil.invalid", " 4273", "123456"])("fails closed for invalid port %s", port => {
    expect(() => offerPrintOrigin(request(), env(port))).toThrow(ForbiddenError);
  });
  it.each<Record<string, string>>([
    { host: "localhost:4273" }, { host: "127.0.0.1:8027" }, { host: "evil.invalid" },
    { "x-forwarded-host": "evil.invalid" }, { origin: "http://evil.invalid" },
    { origin: "http://127.0.0.1:8027" }, { "sec-fetch-site": "cross-site" },
  ])("enforces existing desktop host policy: %j", headers => {
    expect(() => offerPrintOrigin(request("4273", "GET", headers), env("4273"))).toThrow(ForbiddenError);
  });
  it("does not take protocol or port from forwarded headers", () => {
    expect(offerPrintOrigin(request("4273", "GET", {
      "x-forwarded-host": "127.0.0.1:4273", "x-forwarded-proto": "https",
      "x-forwarded-port": "9999", forwarded: "host=evil.invalid;proto=https",
    }), env("4273"))).toBe("http://127.0.0.1:4273");
  });
  it("rejects desktop mutations without Origin", () => {
    const req = request("4273", "POST"); req.headers.delete("origin");
    expect(() => offerPrintOrigin(req, env("4273"))).toThrow(ForbiddenError);
  });
  it.each(["server", undefined])("preserves original origin exactly outside desktop (%s)", mode => {
    const req = request("4273", "POST", { host: "proxy.internal", "x-forwarded-host": "ignored.invalid" });
    req.nextUrl.origin = "https://crm.example.test:8443";
    expect(offerPrintOrigin(req, { CRM_DEPLOYMENT_MODE: mode, CRM_DESKTOP_PORT: "invalid" })).toBe(req.nextUrl.origin);
  });
});

const generators = vi.hoisted(() => ({ pdf: vi.fn(async () => Buffer.from("synthetic")), document: vi.fn(async () => ({ id: "synthetic" })) }));
vi.mock("@/modules/commercial-offers/application/offer-pdf", () => ({ generateOfferPdf: generators.pdf }));
vi.mock("@/modules/commercial-offers/application/offer-document", () => ({ generateOfferDocument: generators.document }));
vi.mock("@/server/api-handler", () => ({
  api: (_options: unknown, handler: (context: unknown) => Promise<Response>) => async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => handler({ req, params: await ctx.params, actor: { userId: "synthetic" } }),
  json: (value: unknown, status: number) => Response.json(value, { status }),
}));
import { GET } from "@/app/api/v1/offers/[id]/pdf/route";
import { POST } from "@/app/api/v1/offers/[id]/document/route";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it.each(["desktop", "server"])("both print routes pass the resolved origin (%s)", async mode => {
  vi.stubEnv("CRM_DEPLOYMENT_MODE", mode); vi.stubEnv("CRM_DESKTOP_PORT", "8027");
  const params = { id: "00000000-0000-4000-8000-000000000001" };
  for (const [method, route, generator] of [["GET", GET, generators.pdf], ["POST", POST, generators.document]] as const) {
    const req = new NextRequest(`http://localhost:4570/api/v1/offers/${params.id}`, { method, headers: { host: "127.0.0.1:8027", origin: "http://127.0.0.1:8027" } });
    const response = await route(req, { params: Promise.resolve(params) });
    expect(response.status).toBe(method === "GET" ? 200 : 201);
    expect(generator).toHaveBeenCalledWith({ userId: "synthetic" }, params.id, mode === "desktop" ? "http://127.0.0.1:8027" : req.nextUrl.origin);
  }
});
