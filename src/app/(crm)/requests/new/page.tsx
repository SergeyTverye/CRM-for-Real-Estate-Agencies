import { requirePageActor } from "@/server/page-auth";
import { getClientCard } from "@/modules/clients/application/client-queries";
import { getPropertyCard } from "@/modules/properties/application/property-queries";
import { listNeeds } from "@/modules/needs/application/need-queries";
import { previewResponsible } from "@/modules/requests/application/request-service";
import { NotFoundError } from "@/shared/errors";
import { labelOf } from "@/shared/codebook";
import { tz } from "@/server/format";
import { dictOptions, loadDictionaries, userOptions, type Option } from "@/server/options";
import { Card, PageHeader } from "@/ui/components";
import { needBriefLine, needTitle } from "@/ui/domain/need-params-summary";
import type { ClientPick, PropertyPick } from "@/ui/domain/need-pickers";
import { RequestForm, type ResponsiblePreview } from "./request-form";

export const metadata = { title: "Новое обращение" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: string | undefined) => (v && UUID_RE.test(v) ? v : undefined);

export default async function NewRequestPage({ searchParams }: { searchParams: Promise<{ propertyId?: string; clientId?: string; advertisementId?: string }> }) {
  const actor = await requirePageActor();
  const sp = await searchParams;
  const propertyId = uuid(sp.propertyId);
  const clientId = uuid(sp.clientId);
  const advertisementId = uuid(sp.advertisementId);
  const dicts = await loadDictionaries();

  let property: PropertyPick | null = null;
  if (propertyId) {
    try {
      const { property: p } = await getPropertyCard(actor, propertyId);
      // В форму передаются только общие поля объекта — без сведений о собственниках.
      property = { id: p.id, addressText: p.addressText, price: p.price?.toString() ?? null, responsible: p.responsible ? { id: p.responsible.id, displayName: p.responsible.displayName } : null };
    } catch (e) {
      if (!(e instanceof NotFoundError)) throw e;
    }
  }
  let preview: ResponsiblePreview | null = null;
  if (property || advertisementId) preview = await previewResponsible(actor, { propertyId: property?.id, advertisementId });

  let client: ClientPick | null = null;
  let clientNeeds: Option[] = [];
  if (clientId) {
    try {
      const c = await getClientCard(actor, clientId);
      client = { id: c.id, displayName: c.displayName, contacts: c.contacts.slice(0, 1).map((x) => ({ rawValue: x.rawValue })) };
      const needs = await listNeeds(actor, { clientId, status: "open", pageSize: "50" });
      clientNeeds = needs.items.map((n) => ({ value: n.id, label: [needTitle(dicts, n), needBriefLine(n), labelOf("needStage", n.stage)].filter(Boolean).join(" · ") }));
    } catch (e) {
      if (!(e instanceof NotFoundError)) throw e;
    }
  }

  const isManager = actor.role === "manager";
  const users = isManager ? await userOptions() : [];

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Новое обращение"
        back={{ href: "/requests", label: "Обращения" }}
        subtitle="Быстрая фиксация звонка или заявки: факт обращения сохраняется всегда, даже без дальнейшей работы."
      />
      <Card>
        <RequestForm
          actorId={actor.userId}
          isManager={isManager}
          timeZone={tz()}
          channels={dictOptions(dicts, "lead_channel")}
          sources={dictOptions(dicts, "lead_source")}
          users={users}
          needOptions={{
            operationTypes: dictOptions(dicts, "need_operation_type"),
            propertyTypes: dictOptions(dicts, "property_type"),
            propertySubtypes: dictOptions(dicts, "property_subtype"),
            commercialPurposes: dictOptions(dicts, "commercial_purpose"),
          }}
          initialProperty={property}
          initialPreview={preview}
          initialClient={client}
          initialClientNeeds={clientNeeds}
          advertisementId={advertisementId}
        />
      </Card>
    </div>
  );
}
