import { requirePageActor } from "@/server/page-auth";
import { loadDictionaries } from "@/server/options";
import { Card, PageHeader } from "@/ui/components";
import { OfferForm } from "@/ui/domain/offer-form";
import { legalEntityOptions, loadNeedPrefill, loadPropertyPick, needLabels } from "@/ui/domain/deal-prefill";
import { itemFromPick, type OfferSuggestion, type PropertyPick } from "@/ui/domain/deal-form-values";

export const metadata = { title: "Новое коммерческое предложение" };

export default async function NewOfferPage({ searchParams }: { searchParams: Promise<{ needId?: string; propertyIds?: string }> }) {
  const actor = await requirePageActor();
  const { needId, propertyIds } = await searchParams;
  const ids = [...new Set((propertyIds ?? "").split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 30);
  const [need, dicts, legalEntities, picks] = await Promise.all([loadNeedPrefill(actor, needId), loadDictionaries(), legalEntityOptions(), Promise.all(ids.map((id) => loadPropertyPick(actor, id)))]);
  const properties = picks.filter((p): p is PropertyPick => p !== null);
  const labels = needLabels(dicts);
  const suggestions: OfferSuggestion[] = (need?.card.need.matches ?? [])
    .filter((m) => m.status !== "rejected" && m.status !== "withdrawn")
    .map((m) => ({ propertyId: m.property.id, addressText: m.property.addressText, price: m.property.price?.toString() ?? null, area: m.property.area?.toString() ?? null, matchStatus: m.status }))
    .filter((s, i, arr) => arr.findIndex((x) => x.propertyId === s.propertyId) === i);
  const title = need?.pick.clientVisible ? `Коммерческое предложение — ${need.pick.client.displayName}` : "";
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Новое коммерческое предложение"
        back={need ? { href: `/needs/${need.pick.id}`, label: "Потребность" } : { href: "/offers", label: "Предложения" }}
        subtitle="Цены и условия объектов сохраняются в КП на момент подготовки и не меняются вслед за карточкой объекта."
      />
      {needId && !need ? <div className="alert alert-warning mb-3">Потребность не найдена или недоступна — выберите её в форме.</div> : null}
      {properties.length < ids.length ? <div className="alert alert-warning mb-3">Часть объектов не найдена и не добавлена.</div> : null}
      <Card>
        <OfferForm
          mode="create"
          initialNeed={need?.pick ?? null}
          labels={labels}
          legalEntities={legalEntities}
          suggestions={suggestions}
          initial={{ title, introText: "", notes: "", legalEntityId: legalEntities.length === 1 ? legalEntities[0]!.value : "", expiresAt: "", items: properties.map(itemFromPick) }}
        />
      </Card>
    </div>
  );
}
