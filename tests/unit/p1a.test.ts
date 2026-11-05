import { describe, expect, it } from "vitest";
import { isProspectiveResult } from "@/modules/requests/domain/prospective";
import { dealChecklistTemplate } from "@/modules/deals/domain/checklist-template";
import { postdealTemplatesFor } from "@/modules/deals/domain/postdeal-templates";
import { percent } from "@/modules/reports/application/report-service";
import { publicHttpUrl } from "@/modules/export/application/print-data";
describe("P1A domain", () => {
 it("uses continuing result codes, never spam or one-off", () => { expect(isProspectiveResult("new_need")).toBe(true); expect(isProspectiveResult("linked_existing_need")).toBe(true); expect(isProspectiveResult("invalid_or_spam")).toBe(false); expect(isProspectiveResult("one_off_service")).toBe(false); });
 it("templates vary by operation and retain stable unique codes", () => { expect(dealChecklistTemplate("rent").find(i => i.code === "agreement")?.title).not.toBe(dealChecklistTemplate("sale").find(i => i.code === "agreement")?.title); expect(new Set(dealChecklistTemplate("rent").map(i => i.code)).size).toBe(9); expect(postdealTemplatesFor("rent").length).toBeLessThanOrEqual(10); });
 it("rounds shares and rejects unsafe printable URLs", () => { expect(percent(1, 3)).toBe(33.3); expect(percent(0, 0)).toBe(100); expect(publicHttpUrl("javascript:alert(1)")).toBeNull(); expect(publicHttpUrl("https://user:secret@example.org")).toBeNull(); });
});
