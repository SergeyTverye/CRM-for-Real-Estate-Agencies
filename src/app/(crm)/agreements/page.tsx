import Link from "next/link";
import { requirePageActor } from "@/server/page-auth";
import { listAgreements } from "@/modules/agreements/application/agreement-service";
import { dictLabel } from "@/modules/dictionaries/application/dictionaries-service";
import { getConfig } from "@/shared/config/env";
import { searchParamsToObject } from "@/shared/validation";
import { labelOf } from "@/shared/codebook";
import { fmtDateOnly, fmtDateTime } from "@/server/format";
import { codeOptions, loadDictionaries, userOptions } from "@/server/options";
import { loadList } from "@/server/list-page";
import { Badge, Card, EmptyState, FilterBar, FilterField, PageHeader, Pagination, Select, StatusBadge } from "@/ui/components";
import { ViewTabs } from "@/ui/domain/deal-list-kit";
import { legalEntityOptions } from "@/ui/domain/deal-prefill";

export const metadata = { title: "Договоры" };

export default async function AgreementsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageActor();
  const sp = searchParamsToObject(await searchParams);
  const res = await loadList(() => listAgreements(actor, sp), "/agreements");
  const isManager = actor.role === "manager";
  const [users, legalEntities, dicts] = await Promise.all([isManager ? userOptions() : Promise.resolve([]), legalEntityOptions(), loadDictionaries()]);
  const days = getConfig().AGREEMENT_EXPIRY_WARNING_DAYS;
  const view = sp.view ?? "all";
  const now = new Date();

  return (
    <div>
      <PageHeader
        title="Договоры и соглашения"
        subtitle={isManager ? "Контроль наличия, сроков и требуемых действий по договорам агентства" : "Договоры по вашим клиентам и объектам"}
        actions={
          <Link href="/agreements/new" className="btn btn-primary">
            + Договор
          </Link>
        }
      />
      <ViewTabs
        basePath="/agreements"
        params={sp}
        current={view}
        views={[
          { key: "all", label: "Все" },
          { key: "expiring", label: `Истекают в ${days} дн.`, hint: "Подписанные договоры, срок которых заканчивается" },
          { key: "expired", label: "Просрочены" },
          { key: "absent", label: "Без договора / отказ" },
          { key: "action_required", label: "Требуют действия" },
        ]}
      />
      <FilterBar action="/agreements" resetHref={view !== "all" ? `/agreements?view=${view}` : "/agreements"}>
        {view !== "all" ? <input type="hidden" name="view" value={view} /> : null}
        <FilterField label="Поиск: номер, адрес, клиент" className="w-64">
          <input name="q" defaultValue={sp.q ?? ""} className="input" />
        </FilterField>
        <FilterField label="Тип">
          <Select name="agreementType" value={sp.agreementType} placeholder="Все" options={codeOptions("agreementType")} />
        </FilterField>
        <FilterField label="Статус">
          <Select name="status" value={sp.status} placeholder="Все" options={codeOptions("agreementStatus")} />
        </FilterField>
        <FilterField label="ИП/ООО">
          <Select name="legalEntityId" value={sp.legalEntityId} placeholder="Все" options={legalEntities} />
        </FilterField>
        {users.length ? (
          <FilterField label="Ответственный">
            <Select name="responsibleUserId" value={sp.responsibleUserId} placeholder="Все" options={users} />
          </FilterField>
        ) : null}
        <FilterField label="Архив">
          <Select name="includeArchived" value={sp.includeArchived} placeholder="Без архивных" options={[{ value: "yes", label: "Включая архивные" }]} />
        </FilterField>
      </FilterBar>
      {res.error}
      {res.data ? (
        <Card bodyClassName="">
          {res.data.items.length === 0 ? (
            <EmptyState
              title={view === "all" && !sp.q ? "Договоров пока нет" : "По выбранным условиям договоров нет"}
              hint="Договор связывается с клиентом, объектом или сделкой. Для отсутствующего договора укажите статус «Договора нет» и причину — так он попадёт в контроль."
              action={
                <Link href="/agreements/new" className="btn btn-primary">
                  Добавить договор
                </Link>
              }
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Тип / номер</th>
                  <th>Клиент / объект</th>
                  <th>Ответственный</th>
                  <th>ИП/ООО</th>
                  <th>Статус</th>
                  <th>Экскл.</th>
                  <th>Действует до</th>
                  <th>Ближайшее действие</th>
                </tr>
              </thead>
              <tbody>
                {res.data.items.map((a) => {
                  const task = a.taskLinks[0]?.task;
                  return (
                    <tr key={a.id}>
                      <td>
                        <Link href={`/agreements/${a.id}`} className="link font-medium">
                          {labelOf("agreementType", a.agreementType)}
                        </Link>
                        {a.agreementNumber ? <div className="text-xs text-slate-500">№ {a.agreementNumber}</div> : null}
                      </td>
                      <td>
                        {a.client ? <div>{a.clientVisible ? <Link className="link" href={`/clients/${a.client.id}`}>{a.client.displayName}</Link> : <span className="text-slate-500">Клиент (нет доступа)</span>}</div> : null}
                        {a.property ? (
                          <div className="text-xs">
                            <Link className="link" href={`/properties/${a.property.id}`}>
                              {a.property.addressText}
                            </Link>
                          </div>
                        ) : null}
                        {a.deal ? (
                          <div className="text-xs">
                            <Link className="link" href={`/deals/${a.deal.id}`}>
                              сделка
                            </Link>
                          </div>
                        ) : null}
                      </td>
                      <td>{a.responsible.displayName}</td>
                      <td>{a.legalEntity?.displayName ?? <span className="text-slate-400">—</span>}</td>
                      <td>
                        <StatusBadge status={a.status} label={labelOf("agreementStatus", a.status)} />
                        {a.absenceReasonCode ? <div className="mt-0.5 text-xs text-slate-500">{dictLabel(dicts, "agreement_absence_reason", a.absenceReasonCode)}</div> : null}
                      </td>
                      <td>{a.isExclusive === null ? "—" : a.isExclusive ? "да" : "нет"}</td>
                      <td className="whitespace-nowrap">
                        {a.validUntil ? (
                          <span className={a.isExpired ? "font-medium text-red-600" : a.expiresSoon ? "font-medium text-amber-700" : ""}>{fmtDateOnly(a.validUntil)}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                        {a.isExpired ? (
                          <div>
                            <Badge tone="red">срок истёк</Badge>
                          </div>
                        ) : a.expiresSoon ? (
                          <div>
                            <Badge tone="yellow">скоро истекает</Badge>
                          </div>
                        ) : null}
                      </td>
                      <td className="max-w-xs">
                        {task ? (
                          <>
                            <Link className="link" href={`/tasks/${task.id}`}>
                              {task.title}
                            </Link>
                            <div className={`text-xs ${task.dueAt < now ? "text-red-600" : "text-slate-500"}`}>{fmtDateTime(task.dueAt)}</div>
                          </>
                        ) : null}
                        {a.actionRequired ? <div className="text-xs text-amber-800">Требуется: {a.actionRequired}</div> : null}
                        {!task && !a.actionRequired ? <span className="text-slate-400">нет</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <Pagination page={res.data.page} pageSize={res.data.pageSize} total={res.data.total} basePath="/agreements" params={sp} />
        </Card>
      ) : null}
    </div>
  );
}
