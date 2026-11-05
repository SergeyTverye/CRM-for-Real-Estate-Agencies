import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { db, resetDatabase, seedBase, makeProperty, type TestUsers } from "../helpers/fixtures";
import { listPropertyMedia, uploadPropertyMedia, updatePropertyMedia, propertyCoverUrls } from "@/modules/properties/application/property-media-service";
import { getStorage } from "@/shared/storage/storage-adapter";
import { getDb } from "@/shared/db/client";
import { uploadDocument } from "@/modules/documents/application/document-service";

let users: TestUsers;
async function image(name = "photo.jpg") { const bytes = await sharp({ create: { width: 32, height: 24, channels: 3, background: "blue" } }).jpeg().toBuffer(); return new File([new Uint8Array(bytes)], name, { type: "image/jpeg" }); }
beforeEach(async () => { await resetDatabase(); users = await seedBase(); });

describe("MEDIA acceptance", () => {
  it("keeps 5 photos and 2 documents, one cover, retries only the failed file and restores an archive", async () => {
    const p = await makeProperty(users.realtor1);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await uploadPropertyMedia(users.realtor1, p.id, await image(`photo-${i}.jpg`), { kind: "photo" })).id);
    await uploadPropertyMedia(users.realtor1, p.id, new File(["%PDF-1.4\nSynthetic"], "contract.pdf", { type: "application/pdf" }), { kind: "document", documentTypeCode: "agreement" });
    await expect(uploadPropertyMedia(users.realtor1, p.id, new File(["broken"], "scan.jpg", { type: "image/jpeg" }), { kind: "document" })).rejects.toThrow();
    expect(await db.document.count()).toBe(6);
    await uploadPropertyMedia(users.realtor1, p.id, await image("scan.jpg"), { kind: "document", documentTypeCode: "title_document" });
    expect(await db.property.count()).toBe(1);
    const retry = await uploadPropertyMedia(users.realtor1, p.id, await image("photo-0.jpg"), { kind: "photo" });
    expect(retry.id).toBe(ids[0]);
    const items = await listPropertyMedia(users.realtor1, p.id);
    expect(items.filter((m) => m.kind === "photo")).toHaveLength(5);
    expect(items.filter((m) => m.kind === "document")).toHaveLength(2);
    expect(items.filter((m) => m.isCover)).toHaveLength(1);
    await Promise.all([updatePropertyMedia(users.realtor1, p.id, ids[1]!, { isCover: true }), updatePropertyMedia(users.realtor1, p.id, ids[2]!, { isCover: true })]);
    expect(await db.documentProperty.count({ where: { propertyId: p.id, isCover: true } })).toBe(1);
    await updatePropertyMedia(users.realtor1, p.id, ids[2]!, { caption: "Вход", move: "up" });
    await updatePropertyMedia(users.realtor1, p.id, ids[2]!, { archived: true });
    expect((await listPropertyMedia(users.realtor1, p.id)).map((m) => m.id)).not.toContain(ids[2]);
    expect((await listPropertyMedia(users.realtor1, p.id, true)).find((m) => m.id === ids[2])?.archived).toBe(true);
    await updatePropertyMedia(users.realtor1, p.id, ids[2]!, { archived: false, isCover: true });
    expect((await propertyCoverUrls(users.realtor2, [p.id]))[p.id]).toContain(ids[2]);
    expect(await db.document.count({ where: { propertyLinks: { none: {} } } })).toBe(0);
    expect(await db.document.count({ where: { thumbnailStorageKey: { not: null } } })).toBe(6);
  });
  it("cleans both files on a transaction failure and the full image on thumbnail failure", async () => {
    const p = await makeProperty(users.realtor1);
    const storage = getStorage();
    const remove = vi.spyOn(storage, "remove");
    const put = vi.spyOn(storage, "put").mockImplementationOnce(async (data) => ({ storageKey: "documents/test-original", size: data.length, sha256: "fake" })).mockRejectedValueOnce(new Error("disk full"));
    await expect(uploadPropertyMedia(users.realtor1, p.id, await image(), { kind: "photo" })).rejects.toThrow("disk full");
    expect(remove).toHaveBeenCalledWith("documents/test-original");
    put.mockRestore(); remove.mockRestore();
    const audit = vi.spyOn(getDb(), "$transaction").mockRejectedValueOnce(new Error("transaction failed"));
    const cleanup = vi.spyOn(storage, "remove");
    await expect(uploadPropertyMedia(users.realtor1, p.id, await image(), { kind: "photo" })).rejects.toThrow("transaction failed");
    expect(cleanup).toHaveBeenCalledTimes(2);
    audit.mockRestore(); cleanup.mockRestore();
    expect(await db.document.count()).toBe(0);
  });
  it("shows existing documents of type photo even with a legacy link", async () => {
    const p = await makeProperty(users.realtor1);
    const d = await uploadDocument(users.realtor1, await image("legacy.jpg"), { documentTypeCode: "photo", linkKind: "property", linkId: p.id });
    await db.documentProperty.update({ where: { documentId_propertyId: { documentId: d.id, propertyId: p.id } }, data: { kind: "document" } });
    expect((await listPropertyMedia(users.realtor2, p.id)).find((m) => m.id === d.id)?.kind).toBe("photo");
  });
});
