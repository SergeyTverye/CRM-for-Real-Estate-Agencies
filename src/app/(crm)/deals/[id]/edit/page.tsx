import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/page-auth";
import { getDeal } from "@/modules/deals/application/deal-service";
import { NotFoundError } from "@/shared/errors";
import { tz } from "@/server/format";
import { userOptions } from "@/server/options";
import { Card, PageHeader } from "@/ui/components";
import { DealEditForm } from "@/ui/domain/deal-edit-form";
import { legalEntityOptions } from "@/ui/domain/deal-prefill";

export const metadata = { title: "Редактирование сделки" };

export default async function EditDealPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor();
  const { id } = await params;
  const { deal: d, canEdit } = await getDeal(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const closed = d.status === "completed" || d.status === "cancelled";
  const [legalEntities, users] = await Promise.all([legalEntityOptions(), actor.role === "manager" ? userOptions() : Promise.resolve([])]);
  if (!legalEntities.some((l) => l.value === d.legalEntity.id)) legalEntities.push({ value: d.legalEntity.id, label: `${d.legalEntity.displayName} (неактивно)` });
  return (
    <div className="max-w-4xl">
      <PageHeader title="Редактирование сделки" back={{ href: `/deals/${id}`, label: d.property.addressText }} subtitle="Участники и комиссии изменяются в карточке сделки." />
      {!canEdit || closed ? (
        <div className="alert alert-warning">
          {closed ? "Сделка закрыта — изменения не допускаются (комиссии можно обновлять в карточке)." : "Изменять сделку может ответственный или руководитель."}{" "}
          <Link className="link" href={`/deals/${id}`}>
            Вернуться к сделке
          </Link>
        </div>
      ) : (
        <Card>
          <DealEditForm
            dealId={id}
            updatedAt={d.updatedAt.toISOString()}
            timeZone={tz()}
            legalEntities={legalEntities}
            users={users}
            initial={{
              status: d.status,
              legalEntityId: d.legalEntity.id,
              dealPrice: d.dealPrice?.toString() ?? "",
              preliminaryAgreementAt: d.preliminaryAgreementAt?.toISOString() ?? "",
              mainAgreementAt: d.mainAgreementAt?.toISOString() ?? "",
              registrationAt: d.registrationAt?.toISOString() ?? "",
              notes: d.notes ?? "",
              responsibleUserId: d.responsibleUserId,
            }}
          />
        </Card>
      )}
    </div>
  );
}
