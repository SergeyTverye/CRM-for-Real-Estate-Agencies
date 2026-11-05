import { beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";

const mocks = vi.hoisted(() => ({
  put: vi.fn(), remove: vi.fn(),
  tx: { $queryRaw: vi.fn(), document: { findFirst: vi.fn(), create: vi.fn() }, documentProperty: { aggregate: vi.fn(), count: vi.fn() } },
}));
vi.mock("@/shared/storage/storage-adapter", () => ({ getStorage: () => ({ provider: "fake", put: mocks.put, remove: mocks.remove }) }));
vi.mock("@/shared/db/client", () => ({ db: {}, transaction: (fn: (tx: unknown) => unknown) => fn(mocks.tx) }));
vi.mock("@/modules/properties/application/property-service", () => ({ loadEditableProperty: async () => ({ id: "property" }) }));
vi.mock("@/modules/audit/application/audit", () => ({ writeAudit: async () => {} }));

import { uploadPropertyMedia } from "@/modules/properties/application/property-media-service";
import type { Actor } from "@/modules/auth/domain/actor";
const actor: Actor = { userId: "realtor", role: "realtor", displayName: "Synthetic", login: "synthetic", sessionId: "session", mustChangePassword: false };
const propertyId = "11111111-1111-4111-8111-111111111111";
async function photo(type = "image/jpeg") {
  const data = await sharp({ create: { width: 16, height: 16, channels: 3, background: "red" } }).jpeg().toBuffer();
  return new File([new Uint8Array(data)], "photo.jpg", { type });
}
beforeEach(() => {
  vi.resetAllMocks();
  let seq = 0;
  mocks.put.mockImplementation(async (data: Buffer) => ({ storageKey: `fake/object-${++seq}`, size: data.length, sha256: "checksum" }));
  mocks.remove.mockResolvedValue(undefined);
  mocks.tx.$queryRaw.mockResolvedValue([]);
  mocks.tx.document.findFirst.mockResolvedValue(null);
  mocks.tx.document.create.mockResolvedValue({ id: "new-photo" });
  mocks.tx.documentProperty.aggregate.mockResolvedValue({ _max: { sortOrder: null } });
  mocks.tx.documentProperty.count.mockResolvedValue(0);
});
it("stores a safe full image, thumbnail and linked cover in the same transaction", async () => {
  expect(await uploadPropertyMedia(actor, propertyId, await photo(), { kind: "photo" })).toEqual({ id: "new-photo" });
  const input = mocks.tx.document.create.mock.calls[0]![0].data;
  expect(input.thumbnailStorageKey).toBe("fake/object-2");
  expect(input.propertyLinks.create).toMatchObject({ propertyId, kind: "photo", isCover: true });
  expect((await sharp(mocks.put.mock.calls[1]![0]).metadata()).format).toBe("webp");
});
it("removes the full image if writing its thumbnail fails", async () => {
  mocks.put.mockResolvedValueOnce({ storageKey: "fake/original", size: 100, sha256: "checksum" }).mockRejectedValueOnce(new Error("disk full"));
  await expect(uploadPropertyMedia(actor, propertyId, await photo(), { kind: "photo" })).rejects.toThrow("disk full");
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("fake/original");
  expect(mocks.tx.document.create).not.toHaveBeenCalled();
});
it("removes both stored objects when the link transaction fails", async () => {
  mocks.tx.document.create.mockRejectedValueOnce(new Error("database rejected link"));
  await expect(uploadPropertyMedia(actor, propertyId, await photo(), { kind: "photo" })).rejects.toThrow("database rejected link");
  expect(mocks.remove.mock.calls.map(([key]) => key)).toEqual(["fake/object-1", "fake/object-2"]);
});
it("reuses a committed file after a lost response and cleans redundant objects", async () => {
  mocks.tx.document.findFirst.mockResolvedValue({ id: "previous-upload" });
  expect(await uploadPropertyMedia(actor, propertyId, await photo(), { kind: "photo" })).toEqual({ id: "previous-upload" });
  expect(mocks.tx.document.create).not.toHaveBeenCalled();
  expect(mocks.remove).toHaveBeenCalledTimes(2);
});
it("keeps a JPEG scan a closed document rather than classifying by MIME", async () => {
  await uploadPropertyMedia(actor, propertyId, await photo(), { kind: "document", documentTypeCode: "agreement" });
  const input = mocks.tx.document.create.mock.calls[0]![0].data;
  expect(input.documentTypeCode).toBe("agreement");
  expect(input.propertyLinks.create).toMatchObject({ kind: "document", isCover: false });
});
it("rejects a mismatching MIME, a PDF photo and a file over MAX_UPLOAD_MB before storing", async () => {
  await expect(uploadPropertyMedia(actor, propertyId, await photo("text/html"), { kind: "photo" })).rejects.toThrow("MIME");
  await expect(uploadPropertyMedia(actor, propertyId, new File(["%PDF-test"], "a.pdf", { type: "application/pdf" }), { kind: "photo" })).rejects.toThrow("JPEG");
  await expect(uploadPropertyMedia(actor, propertyId, new File([new Uint8Array(2 * 1024 * 1024 + 1)], "a.jpg"), { kind: "photo" })).rejects.toThrow("МБ");
  expect(mocks.put).not.toHaveBeenCalled();
});
