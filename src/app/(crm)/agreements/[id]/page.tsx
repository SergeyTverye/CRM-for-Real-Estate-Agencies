import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/page-auth";
import { getAgreement } from "@/modules/agreements/application/agreement-service";
import { listTasksLinkedTo } from "@/modules/tasks/application/task-queries";
import { dictLabel } from "@/modules/dictionaries/application/dictionaries-service";
import { getConfig } from "@/shared/config/env";
import { NotFoundError } from "@/shared/errors";
import { labelOf } from "@/shared/codebook";
import { addDays, todayAsDateOnly } from "@/shared/time";
import { fmtDateOnly, fmtDateTime, fmtMoney, tz } from "@/server/format";
import { loadDictionaries } from "@/server/options";
import { Badge, Card, Dl, PageHeader, StatusBadge } from "@/ui/components";
import { ActionButton } from "@/ui/client-kit";
import { TaskList } from "@/ui/domain/task-list";
import { DocumentsPanel } from "@/ui/domain/documents-panel";

export const metadata = { title: "Договор" };

export default async function AgreementCardPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor();
  const { id } = await params;
  let data;
  try {
    data = await getAgreement(actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { agreement: a, clientVisible } = data;
  const dicts = await loadDictionaries();
  const tasks = await listTasksLinkedTo(actor, { agreementId: id }, { includeClosed: true, take: 50 });
  const canEdit = actor.role === "manager" || a.responsibleUserId === actor.userId;
  const archived = a.status === "archived" || a.archivedAt !== null;
  const today = todayAsDateOnly(new Date(), tz());
  const warnDays = getConfig().AGREEMENT_EXPIRY_WARNING_DAYS;
  const expired = a.status === "signed" && a.validUntil !== null && a.validUntil < today;
  const expiresSoon = a.status === "signed" && a.validUntil !== null && !expired && a.validUntil <= addDays(today, warnDays);
  const commission = a.commissionType === "percent" && a.commissionValue ? `${a.commissionValue.toString()} %` : fmtMoney(a.commissionValue);
  const taskParams = new URLSearchParams({ agreementId: id, ...(a.client && clientVisible ? { clientId: a.client.id } : {}), ...(a.property ? { propertyId: a.property.id } : {}) });

  return (
    <div>
      <PageHeader
        back={{ href: "/agreements", label: "Договоры" }}
        title={`${labelOf("agreementType", a.agreementType)} договор${a.agreementNumber ? ` № ${a.agreementNumber}` : ""}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={a.status} label={labelOf("agreementStatus", a.status)} />
            {a.isExclusive ? <Badge tone="blue">эксклюзив</Badge> : null}
            {a.legalEntity ? <span>{a.legalEntity.displayName}</span> : null}
            <span>· ответственный: {a.responsible.displayName}</span>
          </span>
        }
        actions={
          <>
            <Link className="btn" href={`/tasks/new?${taskParams.toString()}`}>
              + Задача
            </Link>
            {canEdit && !archived ? (
              <>
                <Link className="btn" href={`/agreements/${id}/edit`}>
                  Редактировать
                </Link>
                <ActionButton url={`/api/v1/agreements/${id}/archive`} label="В архив" className="btn btn-danger" confirm="Перенести договор в архив? Запись и документы сохранятся." />
              </>
            ) : null}
          </>
        }
      />
      {expired ? <div className="alert alert-error mb-4">Срок договора истёк {fmtDateOnly(a.validUntil)}. Продлите договор или измените его статус.</div> : null}
      {expiresSoon ? <div className="alert alert-warning mb-4">Срок договора истекает {fmtDateOnly(a.validUntil)}.</div> : null}
      {a.actionRequired ? <div className="alert alert-info mb-4">Требуется: {a.actionRequired}</div> : null}

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Договор">
          <Dl
            items={[
              ["Тип", labelOf("agreementType", a.agreementType)],
              ["Номер", a.agreementNumber],
              ["Статус", labelOf("agreementStatus", a.status)],
              ["Эксклюзивный", a.isExclusive === null ? null : a.isExclusive ? "Да" : "Нет"],
              ["ИП/ООО", a.legalEntity?.displayName],
              ["Подписан", a.signedAt ? fmtDateOnly(a.signedAt) : null],
              ["Действует", a.validFrom || a.validUntil ? `${a.validFrom ? `с ${fmtDateOnly(a.validFrom)} ` : ""}${a.validUntil ? `до ${fmtDateOnly(a.validUntil)}` : ""}` : null],
              ["Ответственный", a.responsible.displayName],
              ["Создан / изменён", `${fmtDateTime(a.createdAt)} / ${fmtDateTime(a.updatedAt)}`],
              ...(archived ? ([["В архиве с", fmtDateTime(a.archivedAt)]] as [string, string][]) : []),
            ]}
          />
        </Card>
        <div className="space-y-4">
          <Card title="Связи">
            <Dl
              items={[
                ["Клиент", a.client ? clientVisible ? <Link className="link" href={`/clients/${a.client.id}`}>{a.client.displayName}</Link> : <span className="text-slate-500">Клиент (нет доступа)</span> : null],
                ["Объект", a.property ? <Link className="link" href={`/properties/${a.property.id}`}>{a.property.addressText}</Link> : null],
                ["Сделка", a.deal ? <Link className="link" href={`/deals/${a.deal.id}`}>{labelOf("dealStatus", a.deal.status)}</Link> : null],
              ]}
            />
          </Card>
          <Card title="Комиссия и контроль">
            <Dl
              items={[
                ["Тип комиссии", a.commissionType ? dictLabel(dicts, "agreement_commission_type", a.commissionType) : null],
                ["Комиссия", a.commissionValue ? commission : null],
                ["Условия комиссии", a.commissionNotes],
                ["Причина отсутствия / отказа", a.absenceReasonCode ? dictLabel(dicts, "agreement_absence_reason", a.absenceReasonCode) : null],
                ["Требуемое действие", a.actionRequired],
                ["Примечания", a.notes ? <span className="whitespace-pre-wrap">{a.notes}</span> : null],
              ]}
            />
          </Card>
        </div>
      </div>

      <div className="space-y-4">
        <TaskList title="Задачи по договору" tasks={tasks} emptyHint="Задач по договору нет" newHref={`/tasks/new?${taskParams.toString()}`} />
        <section id="documents" aria-label="Документы договора" className="scroll-mt-4">
          <DocumentsPanel actor={actor} link={{ kind: "agreement", id }} canUpload={canEdit && !archived} />
        </section>
      </div>
    </div>
  );
}
