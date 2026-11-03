import { requirePageActor } from "@/server/page-auth";
import { tz } from "@/server/format";
import { dictOptions, loadDictionaries, userOptions } from "@/server/options";
import { Card, PageHeader } from "@/ui/components";
import { AdForm } from "@/ui/domain/ad-form";
import { emptyAd } from "@/ui/domain/deal-form-values";
import { loadPropertyPick } from "@/ui/domain/deal-prefill";

export const metadata = { title: "Новое объявление" };

export default async function NewAdvertisementPage({ searchParams }: { searchParams: Promise<{ propertyId?: string }> }) {
  const actor = await requirePageActor();
  const { propertyId } = await searchParams;
  const [property, dicts] = await Promise.all([loadPropertyPick(actor, propertyId), loadDictionaries()]);
  const users = actor.role === "manager" ? await userOptions() : [];
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Новое рекламное объявление"
        back={property ? { href: `/properties/${property.id}`, label: property.addressText } : { href: "/advertisements", label: "Реклама" }}
        subtitle="Объявление ведёт ответственный за объект риелтор или руководитель. Публикация на площадке выполняется вручную."
      />
      {propertyId && !property ? <div className="alert alert-warning mb-3">Объект не найден — выберите его в форме.</div> : null}
      <Card>
        <AdForm mode="create" initial={emptyAd()} initialProperty={property} platforms={dictOptions(dicts, "ad_platform")} timeZone={tz()} users={users} />
      </Card>
    </div>
  );
}
