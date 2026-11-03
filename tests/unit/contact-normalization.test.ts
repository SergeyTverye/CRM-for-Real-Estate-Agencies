import { describe, expect, it } from "vitest";
import { guessContactType, normalizeEmail, normalizePhone } from "@/modules/clients/domain/contact-normalization";

describe("нормализация контактов", () => {
  it.each([
    ["8 (912) 345-67-89", "+79123456789"],
    ["+7 912 345 67 89", "+79123456789"],
    ["79123456789", "+79123456789"],
    ["9123456789", "+79123456789"],
    ["+375 29 123-45-67", "+375291234567"],
    ["12-34", null],
  ])("телефон %s → %s", (raw, expected) => expect(normalizePhone(raw)).toBe(expected));

  it("e-mail в нижний регистр, некорректный — null", () => {
    expect(normalizeEmail("  Client@Example.RU ")).toBe("client@example.ru");
    expect(normalizeEmail("not-an-email")).toBeNull();
  });

  it("тип контакта по значению", () => {
    expect(guessContactType("a@b.ru")).toBe("email");
    expect(guessContactType("8 900 000 00 00")).toBe("phone");
    expect(guessContactType("ВКонтакте id")).toBe("other");
  });
});
