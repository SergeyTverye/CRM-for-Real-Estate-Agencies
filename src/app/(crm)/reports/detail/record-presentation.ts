import type { Actor } from "@/modules/auth/domain/actor";
import type { DetailRow } from "@/modules/reports/application/report-service";
import { getRequestCard } from "@/modules/requests/application/request-queries";
import { getNeedCard } from "@/modules/needs/application/need-queries";
import { getShowing } from "@/modules/showings/application/showing-service";
import { getOffer } from "@/modules/commercial-offers/application/offer-service";
import { getDeal } from "@/modules/deals/application/deal-service";
import { getClientCard } from "@/modules/clients/application/client-queries";
import { getTask } from "@/modules/tasks/application/task-queries";
import { labelOf } from "@/shared/codebook";

export type NamedLink = { id: string; label: string; href: string };
export interface ReportRecord { label: string; client?: NamedLink; property?: NamedLink; employee?: string; sourceCode?: string; status?: string; at?: Date | string | null }
const clientLink = (c: { id: string; displayName: string } | null): NamedLink | undefined => c ? { id: c.id, label: c.displayName, href: `/clients/${c.id}` } : undefined;
const propertyLink = (p: { id: string; addressText: string } | null): NamedLink | undefined => p ? { id: p.id, label: p.addressText, href: `/properties/${p.id}` } : undefined;
export async function reportRecord(actor: Actor, row: DetailRow): Promise<ReportRecord> {
  const [, kind, id] = row.href.split("/");
  if (!id) return { label: "Запись CRM" };
  switch (kind) {
    case "requests": {
      const { request: r } = await getRequestCard(actor, id);
      return { label: r.summary || "Обращение", client: clientLink(r.client), property: propertyLink(r.property), employee: r.responsible?.displayName, sourceCode: r.sourceCode, status: labelOf("leadStatus", r.statusCode), at: r.occurredAt };
    }
    case "needs": {
      const { need: n } = await getNeedCard(actor, id);
      return { label: `Потребность · ${n.client?.displayName ?? "Клиент"}`, client: clientLink(n.client), employee: n.responsible.displayName, status: labelOf("needStatus", n.status), at: n.openedAt };
    }
    case "showings": {
      const { showing: s } = await getShowing(actor, id);
      return { label: `Показ · ${s.property.addressText}`, property: propertyLink(s.property), client: clientLink(s.need.client), employee: s.responsible.displayName, status: labelOf("showingStatus", s.status), at: s.scheduledAt };
    }
    case "offers": {
      const { offer: o } = await getOffer(actor, id);
      return { label: o.title || "Коммерческое предложение", client: clientLink(o.need.client), employee: o.responsible.displayName, status: labelOf("offerStatus", o.status), at: o.sentAt ?? o.createdAt };
    }
    case "deals": {
      const { deal: d } = await getDeal(actor, id);
      const commission = row.amount ? d.commissions.find(c => c.id === row.id) : undefined;
      return { label: `${row.amount ? "Комиссия" : "Сделка"} · ${d.property.addressText}`, property: propertyLink(d.property), client: clientLink(d.parties.find(p => p.client)?.client ?? null), employee: d.responsible.displayName, status: commission ? labelOf("commissionStatus", commission.status) : labelOf("dealStatus", d.status), at: commission ? commission.receivedAt : d.closedAt ?? d.openedAt };
    }
    case "clients": {
      const c = await getClientCard(actor, id);
      return { label: row.label === "Коммуникация" ? `Коммуникация · ${c.displayName}` : c.displayName, client: clientLink(c), employee: row.label === "Коммуникация" ? undefined : c.responsible?.displayName, status: labelOf("clientStatus", c.status) };
    }
    case "tasks": {
      const t = await getTask(actor, id);
      const client = t.links.find(l => l.kind === "client" && l.href);
      const property = t.links.find(l => l.kind === "property" && l.href);
      return { label: t.title, client: client?.href ? { ...client, href: client.href } : undefined, property: property?.href ? { ...property, href: property.href } : undefined, employee: t.responsible.displayName, status: labelOf("taskStatus", t.status), at: t.completedAt ?? t.dueAt };
    }
    default: return { label: "Запись CRM" };
  }
}
