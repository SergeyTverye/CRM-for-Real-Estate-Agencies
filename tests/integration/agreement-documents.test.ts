import { beforeEach, expect, it } from "vitest";
import { Document, Packer, Paragraph } from "docx";
import { createAgreement, archiveAgreement } from "@/modules/agreements/application/agreement-service";
import { archiveDocument, listDocumentsFor, uploadDocument } from "@/modules/documents/application/document-service";
import { ValidationError } from "@/shared/errors";
import { GET as download } from "@/app/api/v1/documents/[id]/download/route";
import { apiRequest, db, makeClient, resetDatabase, routeParams, seedBase, sessionCookieFor, type TestUsers } from "../helpers/fixtures";

let users: TestUsers;
beforeEach(async () => { await resetDatabase(); users = await seedBase(); });

it("PDF/DOCX договора: тип, юрлицо, список, скачивание и архив без удаления файла", async () => {
  const client = await makeClient(users.realtor1);
  const agreement = await createAgreement(users.realtor1, { clientId: client.id, agreementType: "exclusive", status: "draft", legalEntityId: users.llcId });
  const docx = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("Синтетическое допсоглашение")] }] }));
  const fixtures = [
    { name: "договор.pdf", data: Buffer.from("%PDF-1.4 synthetic"), type: "agreement" },
    { name: "допсоглашение.docx", data: docx, type: "agreement_addendum" },
    { name: "приложение.pdf", data: Buffer.from("%PDF-1.4 attachment"), type: "agreement_attachment" },
  ];
  for (const fixture of fixtures) {
    const doc = await uploadDocument(users.realtor1, new File([new Uint8Array(fixture.data)], fixture.name), { documentTypeCode: fixture.type, linkKind: "agreement", linkId: agreement.id });
    const row = await db.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect(row.legalEntityId).toBe(users.llcId);
    const response = await download(apiRequest("GET", `/api/v1/documents/${doc.id}/download`, { cookie: await sessionCookieFor(users.realtor1) }), routeParams({ id: doc.id }));
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(fixture.data);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain(encodeURIComponent(fixture.name));
  }
  const list = await listDocumentsFor(users.realtor1, { kind: "agreement", id: agreement.id });
  expect(list).toHaveLength(3);
  expect(list.every(d => d.createdAt instanceof Date && d.uploader.displayName && !('storageKey' in d))).toBe(true);
  await archiveDocument(users.realtor1, list[0]!.id);
  expect(await listDocumentsFor(users.realtor1, { kind: "agreement", id: agreement.id })).toHaveLength(2);
  expect(await listDocumentsFor(users.manager, { kind: "agreement", id: agreement.id }, { includeArchived: true })).toHaveLength(3);
  const archived = await download(apiRequest("GET", `/api/v1/documents/${list[0]!.id}/download`, { cookie: await sessionCookieFor(users.manager) }), routeParams({ id: list[0]!.id }));
  expect(archived.status).toBe(200);
  await archived.arrayBuffer();
  await archiveAgreement(users.realtor1, agreement.id);
  await expect(uploadDocument(users.manager, new File(["%PDF test"], "new.pdf"), { documentTypeCode: "agreement", linkKind: "agreement", linkId: agreement.id })).rejects.toBeInstanceOf(ValidationError);
  expect(await db.document.count()).toBe(3);
});
