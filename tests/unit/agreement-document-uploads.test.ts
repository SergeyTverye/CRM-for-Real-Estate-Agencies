import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadAgreementDocuments } from "@/ui/domain/agreement-document-uploads";

afterEach(() => vi.unstubAllGlobals());
describe("очередь документов сохранённого договора", () => {
  it("продолжает загрузку после ошибки и повторяет только неудачные файлы", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{"id":"ok"}'))
      .mockResolvedValueOnce(new Response('{"error":{"code":"VALIDATION_ERROR","message":"Ошибка файла"}}', { status: 400 }))
      .mockResolvedValueOnce(new Response('{"id":"ok2"}'));
    vi.stubGlobal("fetch", fetch);
    const files = ["договор.pdf", "допсоглашение.docx", "приложение.pdf"].map(name => ({ file: new File(["synthetic"], name), documentTypeCode: "agreement" }));
    const failed = await uploadAgreementDocuments("saved-agreement", files);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.file.name).toBe("допсоглашение.docx");
    expect(failed[0]!.error).toBe("Ошибка файла");
    fetch.mockResolvedValueOnce(new Response('{"id":"retry"}'));
    expect(await uploadAgreementDocuments("saved-agreement", failed)).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(4);
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toBe("/api/v1/documents");
      expect(init.body.get("linkId")).toBe("saved-agreement");
    }
  });
  it("сохраняет File при сетевой ошибке", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const file = new File(["%PDF"], "договор.pdf");
    const failed = await uploadAgreementDocuments("saved", [{ file, documentTypeCode: "agreement" }]);
    expect(failed[0]!.file).toBe(file);
    expect(failed[0]!.error).toContain("Сервер недоступен");
  });
});
