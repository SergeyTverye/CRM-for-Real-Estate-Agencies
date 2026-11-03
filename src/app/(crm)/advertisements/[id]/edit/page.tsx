import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/page-auth";
import { getAdvertisement } from "@/modules/advertisements/application/advertisement-service";
import { dictLabel } from "@/modules/dictionaries/application/dictionaries-service";
import { NotFoundError } from "@/shared/errors";
import { dateOnlyString } from "@/shared/time";
import { tz } from "@/server/format";
import { dictOptions, loadDictionaries } from "@/server/options";
import { Card, PageHeader } from "@/ui/components";
import { AdForm, type AdFormValue } from "@/ui/domain/ad-form";

export const metadata = { title: "Редактирование объявления" };

export default async function EditAdvertisementPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor();
  const { id } = await params;
  const { advertisement: ad, canEdit } = await getAdvertisement(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const dicts = await loadDictionaries();
  const initial: AdFormValue = {
    platformCode: ad.platformCode,
    url: ad.url ?? "",
    adText: ad.adText ?? "",
    status: ad.status,
    publishedAt: ad.publishedAt?.toISOString() ?? "",
    expiresAt: dateOnlyString(ad.expiresAt) ?? "",
    comment: ad.comment ?? "",
  };
  return (
    <div className="max-w-4xl">
      <PageHeader title="Редактирование объявления" back={{ href: `/advertisements/${id}`, label: `${dictLabel(dicts, "ad_platform", ad.platformCode)}: ${ad.property.addressText}` }} />
      {!canEdit ? (
        <div className="alert alert-warning">Изменять объявление может ответственный за объект риелтор или руководитель.</div>
      ) : (
        <Card>
          <AdForm mode="edit" adId={id} updatedAt={ad.updatedAt.toISOString()} initial={initial} platforms={dictOptions(dicts, "ad_platform", ad.platformCode)} timeZone={tz()} />
        </Card>
      )}
    </div>
  );
}
