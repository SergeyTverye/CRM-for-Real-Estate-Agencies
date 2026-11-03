import Link from "next/link";
import { requirePageActor } from "@/server/page-auth";
import { listNeeds } from "@/modules/needs/application/need-queries";
import { searchParamsToObject } from "@/shared/validation";
import { labelOf } from "@/shared/codebook";
import { getConfig } from "@/shared/config/env";
import { fmtDateTime } from "@/server/format";
import { codeOptions, dictOptions, loadDictionaries, userOptions } from "@/server/options";
import { loadList } from "@/server/list-page";
import { Badge, Card, EmptyState, FilterBar, FilterField, PageHeader, Pagination, Select, StatusBadge } from "@/ui/components";
import { needBriefLine, needTitle } from "@/ui/domain/need-params-summary";

export const metadata = { title: "Потребности" };

const STATUS_FILTER = [
  { value: "open", label: "Открытые (в работе и на паузе)" },
  { value: "active", label: "В работе" },
  { value: "paused", label: "На паузе" },
  { value: "success", label: "Успешно завершены" },
  { value: "closed", label: "Закрытые" },
  { value: "all", label: "Все" },
];

export default async function NeedsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageActor();
  const sp = searchParamsToObject(await searchParams);
  const res = await loadList(() => listNeeds(actor, sp), "/needs");
  const dicts = await loadDictionaries();
  const isManager = actor.role === "manager";
  const users = isManager ? await userOptions() : [];
  const staleDays = getConfig().NEED_INACTIVITY_DAYS;
  const filtered = Object.keys(sp).some((k) => k !== "page" && k !== "pageSize");
  const now = new Date();

  return (
    <div>
      <PageHeader
        title="Потребности"
        subtitle={isManager ? "Запросы клиентов всех сотрудников" : "Запросы ваших клиентов"}
        actions={
          <Link href="/needs/new" className="btn btn-primary">
            + Потребность
          </Link>
        }
      />
      <FilterBar action="/needs" resetHref="/needs">
        <FilterField label="Поиск: клиент, район, локация" className="w-60">
          <input name="q" defaultValue={sp.q ?? ""} className="input" />
        </FilterField>
        <FilterField label="Статус">
          <Select name="status" value={sp.status ?? "open"} options={STATUS_FILTER} />
        </FilterField>
        <FilterField label="Этап">
          <Select name="stage" value={sp.stage} placeholder="Все" options={codeOptions("needStage")} />
        </FilterField>
        <FilterField label="Операция">
          <Select name="operationType" value={sp.operationType} placeholder="Все" options={dictOptions(dicts, "need_operation_type", sp.operationType)} />
        </FilterField>
        <FilterField label="Тип недвижимости">
          <Select name="propertyType" value={sp.propertyType} placeholder="Все" options={dictOptions(dicts, "property_type", sp.propertyType)} />
        </FilterField>
        {users.length ? (
          <FilterField label="Ответственный">
            <Select name="responsibleUserId" value={sp.responsibleUserId} placeholder="Все" options={users} />
          </FilterField>
        ) : null}
        <div className="flex flex-col justify-end gap-1 pb-0.5 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="withoutNextAction" value="yes" defaultChecked={sp.withoutNextAction === "yes"} /> Без следующего действия
          </label>
          <label className="flex items-center gap-1.5" title={`Нет коммуникаций, предложений, показов, смен этапа и выполненных задач за ${staleDays} дн.`}>
            <input type="checkbox" name="stale" value="yes" defaultChecked={sp.stale === "yes"} /> Без движения {staleDays} дн.
          </label>
        </div>
      </FilterBar>
      {res.error}
      {res.data ? (
        <Card bodyClassName="">
          {res.data.items.length === 0 ? (
            <EmptyState
              title={filtered ? "По выбранным условиям потребностей нет" : "Потребностей пока нет"}
              hint="Потребность создаётся при регистрации обращения или из карточки клиента; у работающей потребности всегда есть следующее действие."
              action={
                <span className="flex gap-2">
                  <Link href="/requests/new" className="btn btn-primary">
                    Зарегистрировать обращение
                  </Link>
                  <Link href="/needs/new" className="btn">
                    Новая потребность
                  </Link>
                </span>
              }
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Клиент</th>
                  <th>Запрос</th>
                  <th>Этап</th>
                  <th>Статус</th>
                  <th>Ответственный</th>
                  <th>Следующее действие</th>
                  <th className="text-right" title="Предложено объектов / показов">
                    Подбор / показы
                  </th>
                </tr>
              </thead>
              <tbody>
                {res.data.items.map((n) => {
                  const next = n.taskLinks[0]?.task;
                  const open = n.status === "active" || n.status === "paused";
                  return (
                    <tr key={n.id}>
                      <td>
                        {n.clientVisible ? (
                          <Link href={`/clients/${n.client.id}`} className="link">
                            {n.client.displayName}
                          </Link>
                        ) : (
                          <span className="text-slate-500" title="Клиент закреплён за другим сотрудником">
                            Клиент другого сотрудника
                          </span>
                        )}
                      </td>
                      <td>
                        <Link href={`/needs/${n.id}`} className="link font-medium">
                          {needTitle(dicts, n)}
                        </Link>
                        {needBriefLine(n) ? <div className="text-xs text-slate-500">{needBriefLine(n)}</div> : null}
                      </td>
                      <td>{labelOf("needStage", n.stage)}</td>
                      <td>
                        <StatusBadge status={n.status} label={labelOf("needStatus", n.status)} />
                      </td>
                      <td>{n.responsible.displayName}</td>
                      <td>
                        {next ? (
                          <>
                            <Link href={`/tasks/${next.id}`} className="hover:underline">
                              {next.title}
                            </Link>
                            <div className={`text-xs ${next.dueAt < now ? "font-medium text-red-600" : "text-slate-500"}`}>
                              {next.dueAt < now ? "Просрочено: " : ""}
                              {fmtDateTime(next.dueAt)}
                            </div>
                          </>
                        ) : open ? (
                          <Badge tone="red">нет действия</Badge>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="text-right tabular-nums">
                        {n._count.matches} / {n._count.showings}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <Pagination page={res.data.page} pageSize={res.data.pageSize} total={res.data.total} basePath="/needs" params={sp} />
        </Card>
      ) : null}
    </div>
  );
}
