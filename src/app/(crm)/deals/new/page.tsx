import { requirePageActor } from "@/server/page-auth";
import { tz } from "@/server/format";
import { loadDictionaries, userOptions } from "@/server/options";
import { Card, PageHeader } from "@/ui/components";
import { NewDealForm } from "@/ui/domain/deal-form";
import { legalEntityOptions, loadClientPick, loadNeedPrefill, loadPropertyPick, needLabels } from "@/ui/domain/deal-prefill";

export const metadata = { title: "Новая сделка" };

/** Роль клиента в сделке по операции потребности. */
const ROLE_BY_OPERATION: Record<string, string> = { buy: "buyer", rent: "tenant", sell: "seller", lease_out: "landlord" };

export default async function NewDealPage({ searchParams }: { searchParams: Promise<{ propertyId?: string; needId?: string; clientId?: string }> }) {
  const actor = await requirePageActor();
  const { propertyId, needId, clientId } = await searchParams;
  const [property, need, dicts, legalEntities] = await Promise.all([loadPropertyPick(actor, propertyId), loadNeedPrefill(actor, needId), loadDictionaries(), legalEntityOptions()]);
  const client = await loadClientPick(actor, clientId ?? (need?.pick.clientVisible ? need.pick.client.id : undefined));
  const users = actor.role === "manager" ? await userOptions() : [];
  const role = need ? (ROLE_BY_OPERATION[need.pick.operationType] ?? "buyer") : "buyer";
  const unavailable = [propertyId && !property ? "объект" : null, needId && !need ? "потребность" : null, clientId && !client ? "клиент" : null].filter(Boolean);
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Новая сделка"
        back={need ? { href: `/needs/${need.pick.id}`, label: "Потребность" } : property ? { href: `/properties/${property.id}`, label: property.addressText } : { href: "/deals", label: "Сделки" }}
        subtitle="Обязательны объект, ИП/ООО агентства и хотя бы один участник. Комиссии — отдельные записи."
      />
      {unavailable.length ? <div className="alert alert-warning mb-3">Не подставлено — запись не найдена или недоступна: {unavailable.join(", ")}.</div> : null}
      <Card>
        <NewDealForm
          timeZone={tz()}
          legalEntities={legalEntities}
          users={users}
          labels={needLabels(dicts)}
          initialProperty={property}
          initialNeed={need?.pick ?? null}
          initialParties={client ? [{ client, partyRole: role }] : []}
          initialLegalEntityId={legalEntities.length === 1 ? legalEntities[0]!.value : ""}
        />
      </Card>
    </div>
  );
}
