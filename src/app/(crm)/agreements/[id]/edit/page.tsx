import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/page-auth";
import { getAgreement } from "@/modules/agreements/application/agreement-service";
import { NotFoundError } from "@/shared/errors";
import { dateOnlyString } from "@/shared/time";
import { labelOf } from "@/shared/codebook";
import { dictOptions, loadDictionaries } from "@/server/options";
import { Card, PageHeader } from "@/ui/components";
import { AgreementForm, type AgreementFormValue } from "@/ui/domain/agreement-form";
import { legalEntityOptions } from "@/ui/domain/deal-prefill";

export const metadata = { title: "Редактирование договора" };

export default async function EditAgreementPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor();
  const { id } = await params;
  const { agreement: a } = await getAgreement(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const canEdit = actor.role === "manager" || a.responsibleUserId === actor.userId;
  const [dicts, legalEntities] = await Promise.all([loadDictionaries(), legalEntityOptions()]);
  // Неактивное юрлицо, уже указанное в договоре, остаётся в списке.
  if (a.legalEntity && !legalEntities.some((o) => o.value === a.legalEntity!.id)) legalEntities.push({ value: a.legalEntity.id, label: `${a.legalEntity.displayName} (неактивно)` });
  const initial: AgreementFormValue = {
    agreementType: a.agreementType,
    status: a.status,
    agreementNumber: a.agreementNumber ?? "",
    isExclusive: a.isExclusive === null ? "" : a.isExclusive ? "true" : "false",
    signedAt: dateOnlyString(a.signedAt) ?? "",
    validFrom: dateOnlyString(a.validFrom) ?? "",
    validUntil: dateOnlyString(a.validUntil) ?? "",
    legalEntityId: a.legalEntityId ?? "",
    onBehalfOfCompany: !(a.status === "signed" && !a.legalEntityId),
    commissionType: a.commissionType ?? "",
    commissionValue: a.commissionValue?.toString() ?? "",
    commissionNotes: a.commissionNotes ?? "",
    absenceReasonCode: a.absenceReasonCode ?? "",
    actionRequired: a.actionRequired ?? "",
    notes: a.notes ?? "",
  };
  const title = `${labelOf("agreementType", a.agreementType)}${a.agreementNumber ? ` № ${a.agreementNumber}` : ""}`;
  return (
    <div className="max-w-4xl">
      <PageHeader title="Редактирование договора" back={{ href: `/agreements/${id}`, label: title }} />
      {!canEdit ? (
        <div className="alert alert-warning">Изменять договор может ответственный сотрудник или руководитель.</div>
      ) : (
        <Card>
          <AgreementForm
            mode="edit"
            agreementId={id}
            updatedAt={a.updatedAt.toISOString()}
            initial={initial}
            options={{
              legalEntities,
              absenceReasons: dictOptions(dicts, "agreement_absence_reason", a.absenceReasonCode),
              commissionTypes: dictOptions(dicts, "agreement_commission_type", a.commissionType),
              users: [],
            }}
          />
        </Card>
      )}
    </div>
  );
}
