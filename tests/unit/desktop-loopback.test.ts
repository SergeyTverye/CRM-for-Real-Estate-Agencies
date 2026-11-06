import { describe, expect, it } from "vitest";
import { desktopLoopbackAllowed } from "@/shared/auth/desktop-loopback";
describe("desktop loopback trust boundary", () => {
  const env = { CRM_DEPLOYMENT_MODE:"desktop", CRM_DESKTOP_PORT:"3511" };
  const request = (fields: Record<string,string>,method="GET",options=env) => desktopLoopbackAllowed(new Headers(fields),method,options);
  it("allows exact loopback navigation and same-origin mutation", () => {
    expect(request({host:"127.0.0.1:3511"})).toBe(true);
    expect(request({host:"127.0.0.1:3511",origin:"http://127.0.0.1:3511"},"POST")).toBe(true);
  });
  it.each(["localhost:3511","127.0.0.1:3512","192.168.1.2:3511","evil.invalid","127.0.0.1:3511.evil.invalid"])("rejects rebound host %s",host => {
    expect(request({host,origin:"http://127.0.0.1:3511","x-forwarded-host":"127.0.0.1:3511"},"POST")).toBe(false);
  });
  it.each(["null","https://127.0.0.1:3511","http://localhost:3511","http://evil.invalid","http://127.0.0.1:3512"])("rejects external origin on GET and POST: %s",origin => {
    for(const method of ["GET","POST"]) expect(request({host:"127.0.0.1:3511",origin},method)).toBe(false);
  });
  it("requires Origin on every mutation", () => {
    for(const method of ["POST","PATCH","PUT","DELETE"]) expect(request({host:"127.0.0.1:3511"},method)).toBe(false);
  });
  it("fails closed for absent binding, forwarded spoof and cross-site fetch", () => {
    expect(request({host:"127.0.0.1:3511"},"GET",{...env,CRM_DESKTOP_PORT:""})).toBe(false);
    expect(request({host:"127.0.0.1:3511","x-forwarded-host":"evil.invalid"})).toBe(false);
    expect(request({host:"127.0.0.1:3511","sec-fetch-site":"cross-site"})).toBe(false);
  });
  it("preserves server reverse-proxy policy", () => {
    expect(request({host:"crm.company.invalid"},"POST",{CRM_DEPLOYMENT_MODE:"server",CRM_DESKTOP_PORT:""})).toBe(true);
  });
});
