import { beforeEach, expect, it } from "vitest";
import sharp from "sharp";
import { db, resetDatabase, seedBase, makeProperty, makeClient, sessionCookieFor, apiRequest, routeParams, type TestUsers } from "../helpers/fixtures";
import { uploadPropertyMedia, listPropertyMedia, updatePropertyMedia } from "@/modules/properties/application/property-media-service";
import { GET as fileGET } from "@/app/api/v1/properties/[id]/media/[documentId]/file/route";
import { GET as thumbnailGET } from "@/app/api/v1/properties/[id]/media/[documentId]/thumbnail/route";
import { GET as downloadGET } from "@/app/api/v1/documents/[id]/download/route";

let u: TestUsers;
beforeEach(async () => { await resetDatabase(); u = await seedBase(); });
it("serves catalogue photos but denies closed JPG scans and their thumbnails to another realtor", async () => {
  const p = await makeProperty(u.realtor1);
  const bytes = await sharp({ create: { width: 20, height: 20, channels: 3, background: "white" } }).png().toBuffer();
  const file = () => new File([new Uint8Array(bytes)], "scan.png", { type: "image/png" });
  const photo = await uploadPropertyMedia(u.realtor1, p.id, file(), { kind: "photo" });
  const closed = await uploadPropertyMedia(u.realtor1, p.id, file(), { kind: "document", documentTypeCode: "agreement" });
  const cookie = await sessionCookieFor(u.realtor2);
  for (const handler of [fileGET, thumbnailGET]) {
    const allowed = await handler(apiRequest("GET", `/api/v1/properties/${p.id}/media/${photo.id}/file`, { cookie }), routeParams({ id: p.id, documentId: photo.id }));
    expect(allowed.status).toBe(200); await allowed.arrayBuffer();
    const denied = await handler(apiRequest("GET", `/api/v1/properties/${p.id}/media/${closed.id}/file`, { cookie }), routeParams({ id: p.id, documentId: closed.id }));
    expect(denied.status).toBe(404);
  }
  expect((await downloadGET(apiRequest("GET", `/api/v1/documents/${closed.id}/download`, { cookie }), routeParams({ id: closed.id }))).status).toBe(404);
  expect((await listPropertyMedia(u.realtor2, p.id)).map((m) => m.id)).toEqual([photo.id]);
  await expect(updatePropertyMedia(u.realtor2, p.id, photo.id, { isCover: true })).rejects.toThrow();
  const grant = await db.propertyContactGrant.create({ data: { propertyId: p.id, userId: u.realtor2.userId, grantedBy: u.manager.userId } });
  const permitted = await thumbnailGET(apiRequest("GET", `/api/v1/properties/${p.id}/media/${closed.id}/thumbnail`, { cookie }), routeParams({ id: p.id, documentId: closed.id }));
  expect(permitted.status).toBe(200); await permitted.arrayBuffer();
  await db.propertyContactGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
  expect((await thumbnailGET(apiRequest("GET", `/api/v1/properties/${p.id}/media/${closed.id}/thumbnail`, { cookie }), routeParams({ id: p.id, documentId: closed.id }))).status).toBe(404);
  const client = await makeClient(u.realtor1);
  await db.documentClient.create({ data: { clientId: client.id, documentId: photo.id } });
  expect((await thumbnailGET(apiRequest("GET", `/api/v1/properties/${p.id}/media/${photo.id}/thumbnail`, { cookie }), routeParams({ id: p.id, documentId: photo.id }))).status).toBe(404);
});
