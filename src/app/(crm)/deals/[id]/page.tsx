import { GenerateTemplateButton } from "@/modules/document-templates/presentation/generate-button";
import { ChecklistPanel } from "./checklist-panel";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/page-auth";
import { getDeal } from "@/modules/deals/application/deal-service";
import { listTasksLinkedTo } from "@/modules/tasks/application/task-queries";
import { listActiveUsersBrief } from "@/modules/users/application/users-service";
import { NotFoundError } from "@/shared/errors";
import { codeOptions } from "@/server/options";
import { labelOf } from "@/shared/codebook";
import { addDays, dateOnlyString, fromDateTimeLocalValue, localDateString } from "@/shared/time";
import { fmtDateOnly, fmtDateTime, fmtMoney, tz } from "@/server/format";
import { Badge, Card, Dl, EmptyState, PageHeader, StatusBadge } from "@/ui/components";
import { ActionButton, QuickFormButton } from "@/ui/client-kit";
import { TaskList } from "@/ui/domain/task-list";
import { DocumentsPanel } from "@/ui/domain/documents-panel";
import { DealCloseButton, type PostdealTemplateView } from "@/ui/domain/deal-close-dialog";
import { DealPartyAddButton } from "@/ui/domain/deal-party-add";
import { sumMoney } from "@/ui/domain/deal-list-kit";

export const metadata = { title: "Сделка" };

export default async function DealCardPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor();
  const { id } = await params;
  let data;
  try {
    data = await getDeal(actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { deal: d, canEdit, postdealTemplates } = data;
  const zone = tz();
  const isManager = actor.role === "manager";
  const closed = d.status === "completed" || d.status === "cancelled";
  const tasks = await listTasksLinkedTo(actor, { dealId: id }, { includeClosed: true, take: 100 });
  const postdeal = tasks.filter((t) => t.taskType === "postdeal");
  const otherTasks = tasks.filter((t) => t.taskType !== "postdeal");

  // Постсделочные задачи: срок по умолчанию — сегодня + offsetDays, 10:00 по времени экземпляра.
  const now = new Date();
  const dueIn = (days: number) => fromDateTimeLocalValue(`${localDateString(addDays(now, days), zone)}T10:00`, zone);
  const templates: PostdealTemplateView[] = postdealTemplates.map((t) => ({ ...t, defaultDueAt: dueIn(t.offsetDays) }));
  const allUsers = canEdit && !closed ? await listActiveUsersBrief() : [];
  // Руководитель может назначить любого сотрудника. риелтор — себя (по умолчанию — руководитель).
  const responsibleOptions = allUsers
    .filter((u) => isManager || u.id === actor.userId)
    .map((u) => ({ value: u.id, label: `${u.displayName}${u.id === actor.userId ? " (я)" : ""}${u.roleCode === "manager" ? " — руководитель" : ""}` }));

  const partyLabel = (p: (typeof d.parties)[number]) => (p.client ? (p.clientVisible ? p.client.displayName : "Клиент (нет доступа)") : (p.externalPartyName ?? "—"));
  const payerOptions = d.parties.map((p) => ({ value: p.id, label: `${labelOf("dealPartyRole", p.partyRole)}: ${partyLabel(p)}` }));
  const payerLabel = (c: (typeof d.commissions)[number]) => {
    if (!c.payer) return "—";
    const p = d.parties.find((x) => x.id === c.payer!.id);
    return p ? `${labelOf("dealPartyRole", p.partyRole)}: ${partyLabel(p)}` : labelOf("dealPartyRole", c.payer.partyRole);
  };
  const activeCommissions = d.commissions.filter((c) => !["waived", "cancelled"].includes(c.status));
  const receivedSum = sumMoney(activeCommissions.filter((c) => c.status === "received").map((c) => c.amount));
  const totalSum = sumMoney(activeCommissions.map((c) => c.amount));
  const commissionFields = (c?: (typeof d.commissions)[number]) => [
    { name: "amount", label: "Сумма, ₽", required: true, initial: c?.amount.toString() ?? "" },
    { name: "status", label: "Статус", type: "select" as const, required: true, options: codeOptions("commissionStatus"), initial: c?.status ?? "planned" },
    { name: "dueAt", label: "Срок оплаты", type: "date" as const, initial: dateOnlyString(c?.dueAt) ?? "" },
    { name: "receivedAt", label: "Дата получения", type: "datetime" as const, initial: c?.receivedAt?.toISOString() ?? "", hint: "Для статуса «Получена» без даты подставится текущий момент" },
    { name: "payerPartyId", label: "Плательщик", type: "select" as const, options: payerOptions, initial: c?.payerPartyId ?? "" },
    { name: "comment", label: "Комментарий", type: "textarea" as const, initial: c?.comment ?? "" },
  ];

  return (
    <div>
      <PageHeader
        back={{ href: "/deals", label: "Сделки" }}
        title={`Сделка: ${d.property.addressText}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={d.status} label={labelOf("dealStatus", d.status)} />
            <span>{d.legalEntity.displayName}</span>
            <span>· ответственный: {d.responsible.displayName}</span>
            <span>· открыта {fmtDateTime(d.openedAt)}</span>
          </span>
        }
        actions={
          <>
            <GenerateTemplateButton entityKind="deal" entityId={id} />
            <Link className="btn" href={`/agreements/new?dealId=${id}`}>
              + Договор
            </Link>
            <Link className="btn" href={`/tasks/new?dealId=${id}&propertyId=${d.property.id}`}>
              + Задача
            </Link>
            {canEdit && !closed ? (
              <>
                <Link className="btn" href={`/deals/${id}/edit`}>
                  Редактировать
                </Link>
                <DealCloseButton dealId={id} updatedAt={d.updatedAt.toISOString()} templates={templates} responsibleOptions={responsibleOptions} timeZone={zone} defaultExtraDueAt={dueIn(7)} />
              </>
            ) : null}
          </>
        }
      />
      {closed ? (
        <div className="alert alert-info mb-4">
          Сделка {d.status === "completed" ? "завершена" : "отменена"} {fmtDateTime(d.closedAt)}. Клиенты остаются активными; постсделочное сопровождение ведётся задачами ниже.
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Сделка">
          <Dl
            items={[
              ["Объект", <Link key="p" className="link" href={`/properties/${d.property.id}`}>{d.property.addressText}</Link>],
              ["Этап / статус", labelOf("dealStatus", d.status)],
              ["ИП/ООО", d.legalEntity.displayName],
              ["Цена сделки", fmtMoney(d.dealPrice)],
              ["Ответственный", d.responsible.displayName],
              ["Открыта", fmtDateTime(d.openedAt)],
              ["Предварительный договор", d.preliminaryAgreementAt ? fmtDateTime(d.preliminaryAgreementAt) : null],
              ["Основной договор", d.mainAgreementAt ? fmtDateTime(d.mainAgreementAt) : null],
              ["Регистрация", d.registrationAt ? fmtDateTime(d.registrationAt) : null],
              ["Закрыта", d.closedAt ? fmtDateTime(d.closedAt) : null],
              ["Создал", `${d.creator.displayName} · ${fmtDateTime(d.createdAt)}`],
              ["Примечания", d.notes ? <span className="whitespace-pre-wrap">{d.notes}</span> : null],
            ]}
          />
        </Card>
        <Card title={`Участники (${d.parties.length})`} bodyClassName="" actions={canEdit && !closed ? <DealPartyAddButton dealId={id} /> : undefined}>
          <table className="table">
            <thead>
              <tr>
                <th>Роль</th>
                <th>Участник</th>
                <th>Комментарий</th>
                <th className="w-0" aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {d.parties.map((p) => (
                <tr key={p.id}>
                  <td>{labelOf("dealPartyRole", p.partyRole)}</td>
                  <td>
                    {p.client && p.clientVisible ? (
                      <Link className="link" href={`/clients/${p.client.id}`}>
                        {p.client.displayName}
                      </Link>
                    ) : (
                      <span className={p.client ? "text-slate-500" : ""}>{partyLabel(p)}</span>
                    )}
                    {!p.client ? <div className="text-xs text-slate-400">внешний участник</div> : null}
                  </td>
                  <td>{p.comment ?? "—"}</td>
                  <td>
                    {canEdit && !closed && d.parties.length > 1 ? (
                      <ActionButton method="DELETE" url={`/api/v1/deals/${id}/parties/${p.id}`} label="Убрать" className="btn btn-sm btn-link" confirm="Убрать участника из сделки?" />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card
        className="mb-4"
        bodyClassName=""
        title={
          <span>
            Комиссии
            {activeCommissions.length ? (
              <span className="ml-2 text-xs font-normal text-slate-500">
                итого {fmtMoney(totalSum)} · получено {fmtMoney(receivedSum)}
              </span>
            ) : null}
          </span>
        }
        actions={canEdit ? <QuickFormButton label="+ Комиссия" title="Новая комиссия" url={`/api/v1/deals/${id}/commissions`} timeZone={zone} fields={commissionFields()} /> : undefined}
      >
        {d.commissions.length === 0 ? (
          <EmptyState title="Комиссий нет" hint="Каждое обязательство по комиссии — отдельная запись: сумма, статус, срок и плательщик." />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Сумма</th>
                <th>Статус</th>
                <th>Срок оплаты</th>
                <th>Получена</th>
                <th>Плательщик</th>
                <th>Комментарий</th>
                <th className="w-0" aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {d.commissions.map((c) => {
                const overdue = c.dueAt && !["received", "waived", "cancelled"].includes(c.status) && c.dueAt.toISOString().slice(0, 10) < localDateString(now, zone);
                return (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap font-medium">{fmtMoney(c.amount)}</td>
                    <td>
                      <StatusBadge status={c.status} label={labelOf("commissionStatus", c.status)} />
                    </td>
                    <td className={`whitespace-nowrap ${overdue ? "font-medium text-red-600" : ""}`}>
                      {c.dueAt ? fmtDateOnly(c.dueAt) : "—"}
                      {overdue ? (
                        <div>
                          <Badge tone="red">просрочена</Badge>
                        </div>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap">{c.receivedAt ? fmtDateTime(c.receivedAt) : "—"}</td>
                    <td>{payerLabel(c)}</td>
                    <td>{c.comment ?? "—"}</td>
                    <td>
                      {canEdit ? (
                        <QuickFormButton
                          label="Изменить"
                          title="Комиссия"
                          method="PATCH"
                          url={`/api/v1/deals/${id}/commissions/${c.id}`}
                          timeZone={zone}
                          buttonClassName="btn btn-sm btn-link"
                          extraBody={{ expectedUpdatedAt: c.updatedAt.toISOString() }}
                          fields={commissionFields(c)}
                        />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card
        className="mb-4"
        bodyClassName=""
        title={`Договоры (${d.agreements.length})`}
        actions={
          <Link className="btn btn-sm" href={`/agreements/new?dealId=${id}`}>
            + Договор
          </Link>
        }
      >
        {d.agreements.length === 0 ? (
          <EmptyState title="Договоров по сделке нет" hint="Предварительный и основной договоры, акты — добавьте договор и прикрепите файл." />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Договор</th>
                <th>Статус</th>
                <th>Действует до</th>
              </tr>
            </thead>
            <tbody>
              {d.agreements.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link className="link" href={`/agreements/${a.id}`}>
                      {labelOf("agreementType", a.agreementType)}
                      {a.agreementNumber ? ` № ${a.agreementNumber}` : ""}
                    </Link>
                  </td>
                  <td>
                    <StatusBadge status={a.status} label={labelOf("agreementStatus", a.status)} />
                  </td>
                  <td>{a.validUntil ? fmtDateOnly(a.validUntil) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <p className="mb-4"><a className="btn" href={`/api/v1/export/commissions?dealId=${id}`}>Реестр комиссий CSV</a></p>
      <ChecklistPanel actor={actor} dealId={id} canEdit={canEdit} />
      <div className="space-y-4">
        <TaskList
          title="Постсделочные задачи"
          tasks={postdeal}
          emptyHint={closed ? "Постсделочных задач нет" : "Постсделочные задачи предлагаются при закрытии сделки"}
          newHref={`/tasks/new?dealId=${id}&propertyId=${d.property.id}`}
        />
        {otherTasks.length ? <TaskList title="Прочие задачи по сделке" tasks={otherTasks} /> : null}
        <DocumentsPanel actor={actor} link={{ kind: "deal", id }} />
      </div>
    </div>
  );
}
