import type { PropertyPick } from "./need-pickers";

/**
 * Типы значений и чистые функции форм показов, договоров, рекламы, КП и сделок.
 * Модуль без "use client": его функции вызываются и в server components (предзаполнение),
 * и в клиентских формах.
 */

export type { PropertyPick };

export interface NeedPick {
  id: string;
  operationType: string;
  propertyType: string;
  stage: string;
  status: string;
  district: string | null;
  clientVisible: boolean;
  client: { id: string; displayName: string };
}

export interface NeedLabels {
  operation: Record<string, string>;
  propertyType: Record<string, string>;
}

/** Деньги для клиентских компонентов (строка numeric → «1 234 567 ₽»). */
export function moneyText(v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(n)} ₽`;
}

export function needTitle(n: NeedPick, labels: NeedLabels): string {
  const who = n.clientVisible ? n.client.displayName : "Клиент (нет доступа)";
  return `${who}: ${labels.operation[n.operationType] ?? n.operationType} · ${labels.propertyType[n.propertyType] ?? n.propertyType}`;
}

// ───── Договор ─────

export interface AgreementFormValue {
  agreementType: string;
  status: string;
  agreementNumber: string;
  isExclusive: "" | "true" | "false";
  signedAt: string;
  validFrom: string;
  validUntil: string;
  legalEntityId: string;
  onBehalfOfCompany: boolean;
  commissionType: string;
  commissionValue: string;
  commissionNotes: string;
  absenceReasonCode: string;
  actionRequired: string;
  notes: string;
}

export const emptyAgreement = (): AgreementFormValue => ({
  agreementType: "exclusive",
  status: "draft",
  agreementNumber: "",
  isExclusive: "",
  signedAt: "",
  validFrom: "",
  validUntil: "",
  legalEntityId: "",
  onBehalfOfCompany: true,
  commissionType: "",
  commissionValue: "",
  commissionNotes: "",
  absenceReasonCode: "",
  actionRequired: "",
  notes: "",
});

// ───── Реклама ─────

export interface AdFormValue {
  platformCode: string;
  url: string;
  adText: string;
  status: string;
  publishedAt: string;
  expiresAt: string;
  comment: string;
}

export const emptyAd = (): AdFormValue => ({ platformCode: "", url: "", adText: "", status: "active", publishedAt: "", expiresAt: "", comment: "" });

// ───── Коммерческое предложение ─────

export interface OfferItemDraft {
  propertyId: string;
  addressText: string;
  /** Текущая цена объекта — подсказка; в КП сохраняется snapshot. */
  currentPrice: string | null;
  price: string;
  terms: string;
  comment: string;
}

export interface OfferFormValue {
  title: string;
  introText: string;
  notes: string;
  legalEntityId: string;
  expiresAt: string;
  items: OfferItemDraft[];
}

export interface OfferSuggestion {
  propertyId: string;
  addressText: string;
  price: string | null;
  area: string | null;
  matchStatus: string;
}

export function itemFromPick(p: PropertyPick): OfferItemDraft {
  return { propertyId: p.id, addressText: p.addressText, currentPrice: p.price, price: "", terms: "", comment: "" };
}
