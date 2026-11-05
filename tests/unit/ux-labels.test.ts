import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { displayLabel } from "@/shared/codebook";
import { BarTable, pct } from "@/ui/domain/report-blocks";
import { PRICE_UNITS } from "@/modules/property-search/domain/types";

describe("UI presentation regressions", () => {
  it("uses no percentage when there is no denominator, while retaining real zero", () => {
    expect(pct(0, 0)).toBe("—");
    expect(pct(0, 4)).toBe("0%");
    expect(pct(3, 6)).toBe("50%");
    const html = renderToStaticMarkup(createElement(BarTable, { rows: [{ key: "empty", label: "Нет событий", count: 0 }], emptyTitle: "Нет данных" }));
    expect(html).not.toContain("100%");
    expect(html).not.toContain("0%");
    expect(html).toContain("—");
  });
  it("names all price units supported by external search", () => {
    for (const code of PRICE_UNITS) expect(displayLabel("price_unit", code)).not.toBe(code);
    expect(displayLabel("need_operation_type", "sale")).toBe("Продажа");
    expect(displayLabel("property_type", "retail")).toBe("Торговое помещение");
    expect(displayLabel("property_type", null)).toBe("—");
  });
});
