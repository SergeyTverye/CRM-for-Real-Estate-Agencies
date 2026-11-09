import { requirePageActor } from "@/server/page-auth";
import { getDeal } from "@/modules/deals/application/deal-service";
import { dictOptions, loadDictionaries, userOptions } from "@/server/options";
import { Card, PageHeader } from "@/ui/components";
import { AgreementForm } from "@/ui/domain/agreement-form";
import { emptyAgreement } from "@/ui/domain/deal-form-values";
import { UUID_RE, legalEntityOptions, loadClientPick, loadPropertyPick, orNull } from "@/ui/domain/deal-prefill";
import { getConfig } from "@/shared/config/env";

export const metadata = { title: "Новый договор" };

export default async function NewAgreementPage({ searchParams }: { searchParams: Promise<{ clientId?: string; propertyId?: string; dealId?: string }> }) {
  const actor = await requirePageActor();
  const { clientId, propertyId, dealId } = await searchParams;
  const [client, property, dealData, dicts, legalEntities] = await Promise.all([
    loadClientPick(actor, clientId),
    loadPropertyPick(actor, propertyId),
    dealId && UUID_RE.test(dealId) ? orNull(() => getDeal(actor, dealId)) : Promise.resolve(null),
    loadDictionaries(),
    legalEntityOptions(),
  ]);
  const users = actor.role === "manager" ? await userOptions() : [];
  const deal = dealData ? { id: dealData.deal.id, label: `${dealData.deal.property.addressText}` } : null;
  
  const dealProperty = dealData && !property ? { id: dealData.deal.property.id, addressText: dealData.deal.property.addressText, price: dealData.deal.property.price?.toString() ?? null, responsible: null } : null;
  const initial = { ...emptyAgreement(), agreementType: dealData ? (dealData.deal.property.operationType === "rent" ? "lease_related" : "sale_related") : "exclusive", legalEntityId: dealData?.deal.legalEntity.id ?? "" };
  const unavailable = [clientId && !client ? "клиент" : null, propertyId && !property ? "объект" : null, dealId && !deal ? "сделка" : null].filter(Boolean);
  const back = deal ? { href: `/deals/${deal.id}`, label: "Сделка" } : client ? { href: `/clients/${client.id}`, label: client.displayName } : property ? { href: `/properties/${property.id}`, label: property.addressText } : { href: "/agreements", label: "Договоры" };
  return (
    <div className="max-w-4xl">
      <PageHeader title="Новый договор / соглашение" back={back} subtitle="Срок, наличие договора и требуемые действия хранятся в отдельных полях, а не в комментарии." />
      {unavailable.length ? <div className="alert alert-warning mb-3">Не подставлено — запись не найдена или недоступна: {unavailable.join(", ")}.</div> : null}
      <Card>
        <AgreementForm
          mode="create"
          uploadPolicy={{ accept: getConfig().uploadAllowedExtensions.map((ext) => `.${ext}`).join(","), maxMb: getConfig().MAX_UPLOAD_MB }}
          initial={initial}
          initialClient={client}
          initialProperty={property ?? dealProperty}
          deal={deal}
          options={{
            legalEntities,
            absenceReasons: dictOptions(dicts, "agreement_absence_reason"),
            commissionTypes: dictOptions(dicts, "agreement_commission_type"),
            users,
          }}
        />
      </Card>
    </div>
  );
}
