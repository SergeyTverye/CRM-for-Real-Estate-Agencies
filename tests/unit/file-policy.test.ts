import { describe, expect, it } from "vitest";
import { sanitizeFileName, validateUpload } from "@/modules/documents/domain/file-policy";

const ALLOWED = ["pdf", "jpg", "png", "docx", "txt"];
const MB = 1024 * 1024;

describe("политика загрузки файлов", () => {
  it("разрешённый PDF", () => expect(validateUpload("договор.pdf", Buffer.from("%PDF-1.7 test"), ALLOWED, MB)).toEqual({ ext: "pdf", mime: "application/pdf" }));
  it("исполняемый файл запрещён даже с безопасным расширением", () =>
    expect(validateUpload("doc.pdf", Buffer.from("MZ\x90\x00"), ALLOWED, MB)).toHaveProperty("error"));
  it("опасное расширение запрещено", () => expect(validateUpload("run.exe", Buffer.from("x"), [...ALLOWED, "exe"], MB)).toHaveProperty("error"));
  it("превышение лимита", () => expect(validateUpload("a.txt", Buffer.alloc(MB + 1, 97), ALLOWED, MB)).toHaveProperty("error"));
  it("подмена содержимого", () => expect(validateUpload("photo.png", Buffer.from("%PDF"), ALLOWED, MB)).toHaveProperty("error"));
  it("имя очищается от пути и управляющих символов", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Users\\a\\Отчёт <1>.pdf")).toBe("Отчёт _1_.pdf");
  });
});
