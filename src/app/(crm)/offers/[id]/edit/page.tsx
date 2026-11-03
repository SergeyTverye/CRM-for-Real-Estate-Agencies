import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/page-auth";
import { getOffer } from "@/modules/commercial-offers/application/offer-service";
import { NotFoundError } from "@/shared/errors";
import { dateOnlyString } from "@/shared/time";
import { Card, PageHeader } from "@/ui/components";
import { OfferForm } from "@/ui/domain/offer-form";
import { legalEntityOptions } from "@/ui/domain/deal-prefill";

export const metadata = { title: "Редактирование КП" };

export default async function EditOfferPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor();
  const { id } = await params;
  const { offer: o } = await getOffer(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const legalEntities = await legalEntityOptions();
  if (o.legalEntity && !legalEntities.some((l) => l.value === o.legalEntity!.id)) legalEntities.push({ value: o.legalEntity.id, label: `${o.legalEntity.displayName} (неактивно)` });
  return (
    <div className="max-w-5xl">
      <PageHeader title="Редактирование КП" back={{ href: `/offers/${id}`, label: o.title ?? "Коммерческое предложение" }} subtitle="В черновике можно менять порядок и состав объектов, цены и условия в предложении." />
      {o.status !== "draft" ? (
        <div className="alert alert-warning">
          Предложение уже не черновик — состав и юрлицо не меняются. <Link className="link" href={`/offers/${id}`}>Вернуться к КП</Link>
        </div>
      ) : (
        <Card>
          <OfferForm
            mode="edit"
            offerId={id}
            updatedAt={o.updatedAt.toISOString()}
            legalEntities={legalEntities}
            initial={{
              title: o.title ?? "",
              introText: o.introText ?? "",
              notes: o.notes ?? "",
              legalEntityId: o.legalEntityId ?? "",
              expiresAt: dateOnlyString(o.expiresAt) ?? "",
              items: o.items.map((i) => ({
                propertyId: i.propertyId,
                addressText: i.addressSnapshot ?? i.property.addressText,
                currentPrice: i.property.price?.toString() ?? null,
                price: i.priceSnapshot?.toString() ?? "",
                terms: i.termsSnapshot ?? "",
                comment: i.comment ?? "",
              })),
            }}
          />
        </Card>
      )}
    </div>
  );
}
