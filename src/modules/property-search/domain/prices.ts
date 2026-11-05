import { Decimal } from "@prisma/client/runtime/client";
import type { PriceUnit } from "./types";
export function convertPrice(price: string | null, from: PriceUnit | null, to: PriceUnit, area: number | null) {
  if (price === null || !from) return null;
  if (from === to) return { amount: price, calculated: false, basis: from };
  if (from === "rub_total" || to === "rub_total") return null;
  let amount = new Decimal(price);
  if (from.includes("m2") !== to.includes("m2")) {
    if (area === null || !Number.isFinite(area) || area <= 0) return null;
    amount = from.includes("m2") ? amount.mul(area) : amount.div(area);
  }
  if (from.endsWith("year") && to.endsWith("month")) amount = amount.div(12);
  if (from.endsWith("month") && to.endsWith("year")) amount = amount.mul(12);
  return { amount: amount.toFixed(2), calculated: true, basis: `Расчёт: ${price} ${from}; площадь ${area ?? "не использована"}; → ${to}` };
}
export function pricePerM2(price: string | null, unit: PriceUnit | null, area: number | null) {
  if (!price || !unit) return null;
  const target = unit === "rub_total" ? "per_m2" : unit.endsWith("year") ? "per_m2_year" : "per_m2_month";
  if (unit.includes("m2")) return { amount: price, unit: target, calculated: false };
  return area !== null && area > 0 ? { amount: new Decimal(price).div(area).toFixed(2), unit: target, calculated: true } : null;
}
