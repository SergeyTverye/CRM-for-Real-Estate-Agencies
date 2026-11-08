import { expect, it } from "vitest";
import { sourceReason } from "@/app/(crm)/property-search/source-reason";
it.each([
  ["PARSE_FAILED", "Площадка изменила разметку — не удалось разобрать"],
  ["FETCH_FAILED", "Площадка недоступна"],
  ["ACCESS_BLOCKED HTTP 401", "Доступ ограничен площадкой (HTTP 401)"],
  ["ACCESS_BLOCKED HTTP 439", "Доступ ограничен площадкой (HTTP 439)"],
  ["Выборка ограничена бюджетом страниц/результатов", "Проверена часть объявлений: достигнут лимит страниц или результатов"],
])("explains source diagnostic %s", (raw, label) => expect(sourceReason(raw, "error")).toBe(label));

it("manual-action diagnostics give a usable import path without technical codes",()=>{
 for(const reason of ["avito: NEEDS_USER_ACTION: CAPTCHA", "SOURCE_CONTINUATION_NOT_ALLOWED"]){
  expect(sourceReason(reason,"needs_user_action")).toContain("добавьте ссылку объявления");
  expect(sourceReason(reason,"needs_user_action")).not.toMatch(/NEEDS_USER_ACTION|CAPTCHA|SOURCE_CONTINUATION/);
 }
});
