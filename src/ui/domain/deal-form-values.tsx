import { displayLabel } from "@/shared/codebook";
import type { PropertyPick } from "./need-pickers";



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


export function moneyText(v: string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(n)} ₽`;
}

export function needTitle(n: NeedPick, labels: NeedLabels): string {
  const who = n.clientVisible ? n.client.displayName : "Клиент (нет доступа)";
  return `${who}: ${labels.operation[n.operationType] ?? displayLabel("need_operation_type", n.operationType)} · ${labels.propertyType[n.propertyType] ?? displayLabel("property_type", n.propertyType)}`;
}



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



export interface OfferItemDraft {
  propertyId: string;
  addressText: string;
  
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
