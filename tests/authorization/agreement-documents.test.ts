import { beforeEach, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createAgreement } from "@/modules/agreements/application/agreement-service";
import { uploadDocument } from "@/modules/documents/application/document-service";
import { GET as list, POST as upload } from "@/app/api/v1/documents/route";
import { GET as download } from "@/app/api/v1/documents/[id]/download/route";
import { POST as archive } from "@/app/api/v1/documents/[id]/archive/route";
import { GET as getAgreement } from "@/app/api/v1/agreements/[id]/route";
import { ForbiddenError, NotFoundError } from "@/shared/errors";
import { ORIGIN, apiRequest, db, makeClient, resetDatabase, routeParams, seedBase, sessionCookieFor, type TestUsers } from "../helpers/fixtures";

let users: TestUsers;
beforeEach(async () => { await resetDatabase(); users = await seedBase(); });

it("чужие договор и документы: прямые URL, список, загрузка, архив; руководитель имеет доступ", async () => {
  const client = await makeClient(users.realtor1);
  const a = await createAgreement(users.realtor1, { clientId: client.id, agreementType: "exclusive", status: "draft" });
  const meta = { documentTypeCode: "agreement", linkKind: "agreement", linkId: a.id };
  const d = await uploadDocument(users.realtor1, new File(["%PDF private"], "закрытый.pdf"), meta);
  const cookie = await sessionCookieFor(users.realtor2);
  expect((await getAgreement(apiRequest("GET", `/api/v1/agreements/${a.id}`, { cookie }), routeParams({ id: a.id }))).status).toBe(404);
  for (const handler of [download, archive]) {
    const response = await handler(apiRequest(handler === download ? "GET" : "POST", `/api/v1/documents/${d.id}`, { cookie }), routeParams({ id: d.id }));
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("закрытый");
  }
  const response = await list(apiRequest("GET", `/api/v1/documents?linkKind=agreement&linkId=${a.id}`, { cookie }), routeParams({}));
  expect(await response.json()).toEqual({ items: [] });
  await expect(uploadDocument(users.realtor2, new File(["%PDF foreign"], "foreign.pdf"), meta)).rejects.toBeInstanceOf(NotFoundError);
  const body = new FormData();
  body.set("file", new File(["%PDF foreign"], "foreign.pdf"));
  for (const [key, value] of Object.entries(meta)) body.set(key, value);
  const deniedUpload = await upload(new NextRequest(`${ORIGIN}/api/v1/documents`, { method: "POST", body, headers: { cookie, origin: ORIGIN, host: new URL(ORIGIN).host } }), routeParams({}));
  expect(deniedUpload.status).toBe(404);
  const managed = await uploadDocument(users.manager, new File(["%PDF manager"], "manager.pdf"), meta);
  const deniedArchive = await archive(apiRequest("POST", `/api/v1/documents/${managed.id}/archive`, { cookie: await sessionCookieFor(users.realtor1) }), routeParams({ id: managed.id }));
  expect(deniedArchive.status).toBe(403);
  expect((await archive(apiRequest("POST", `/api/v1/documents/${d.id}/archive`, { cookie: await sessionCookieFor(users.manager) }), routeParams({ id: d.id }))).status).toBe(200);
  expect(await db.document.count()).toBe(2);
});

it("чтение договора через своего клиента не даёт права загружать файлы чужого ответственного", async () => {
  const client = await makeClient(users.realtor1);
  const a = await createAgreement(users.manager, { clientId: client.id, agreementType: "exclusive", status: "draft", responsibleUserId: users.realtor2.userId });
  await expect(uploadDocument(users.realtor1, new File(["%PDF test"], "test.pdf"), { documentTypeCode: "agreement", linkKind: "agreement", linkId: a.id })).rejects.toBeInstanceOf(ForbiddenError);
});
