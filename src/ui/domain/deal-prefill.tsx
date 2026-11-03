import "server-only";
import type { Actor } from "@/modules/auth/domain/actor";
import { getClientCard } from "@/modules/clients/application/client-queries";
import { getNeedCard } from "@/modules/needs/application/need-queries";
import { getPropertyCard } from "@/modules/properties/application/property-queries";
import { listActiveLegalEntitiesForPicker } from "@/modules/deals/application/legal-entity-picker";
import type { Dictionaries } from "@/modules/dictionaries/application/dictionaries-service";
import { NotFoundError } from "@/shared/errors";
import type { ClientPick } from "./need-pickers";
import type { NeedLabels, NeedPick, PropertyPick } from "./deal-form-values";

/**
 * Предзаполнение форм из параметров URL (?needId, ?propertyId, ?clientId): запись берётся
 * только через запросы с проверкой прав — недоступный id просто не подставляется.
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function orNull<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

const valid = (id: string | undefined): id is string => Boolean(id && UUID_RE.test(id));

export function needLabels(dicts: Dictionaries): NeedLabels {
  return {
    operation: Object.fromEntries(dicts.need_operation_type.map((o) => [o.value, o.label])),
    propertyType: Object.fromEntries(dicts.property_type.map((o) => [o.value, o.label])),
  };
}

export async function loadNeedPrefill(actor: Actor, needId: string | undefined) {
  if (!valid(needId)) return null;
  const card = await orNull(() => getNeedCard(actor, needId));
  if (!card) return null;
  const n = card.need;
  const pick: NeedPick = {
    id: n.id,
    operationType: n.operationType,
    propertyType: n.propertyType,
    stage: n.stage,
    status: n.status,
    district: n.district,
    clientVisible: card.clientVisible,
    client: { id: n.client.id, displayName: n.client.displayName },
  };
  return { pick, card };
}

export async function loadPropertyPick(actor: Actor, propertyId: string | undefined): Promise<PropertyPick | null> {
  if (!valid(propertyId)) return null;
  const card = await orNull(() => getPropertyCard(actor, propertyId));
  if (!card) return null;
  const p = card.property;
  return { id: p.id, addressText: p.addressText, price: p.price?.toString() ?? null, responsible: p.responsible };
}

export async function loadClientPick(actor: Actor, clientId: string | undefined): Promise<ClientPick | null> {
  if (!valid(clientId)) return null;
  const c = await orNull(() => getClientCard(actor, clientId));
  if (!c) return null;
  return { id: c.id, displayName: c.displayName, contacts: c.contacts.slice(0, 1).map((x) => ({ rawValue: x.rawValue })) };
}

export async function legalEntityOptions(): Promise<{ value: string; label: string }[]> {
  const rows = await listActiveLegalEntitiesForPicker();
  return rows.map((r) => ({ value: r.id, label: r.displayName }));
}
