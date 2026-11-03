import Link from "next/link";
import { requirePageActor } from "@/server/page-auth";
import { listRequests } from "@/modules/requests/application/request-queries";
import { searchParamsToObject } from "@/shared/validation";
import { labelOf } from "@/shared/codebook";
import { dictLabel } from "@/modules/dictionaries/application/dictionaries-service";
import { fmtDateTime } from "@/server/format";
import { codeOptions, dictOptions, loadDictionaries, userOptions } from "@/server/options";
import { loadList } from "@/server/list-page";
import { Badge, Card, EmptyState, FilterBar, FilterField, PageHeader, Pagination, Select, StatusBadge } from "@/ui/components";

export const metadata = { title: "Обращения" };

export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageActor();
  const sp = searchParamsToObject(await searchParams);
  const res = await loadList(() => listRequests(actor, sp), "/requests");
  const dicts = await loadDictionaries();
  const isManager = actor.role === "manager";
  const users = isManager ? await userOptions() : [];
  const filtered = Object.keys(sp).some((k) => k !== "page" && k !== "pageSize");
  const now = new Date();

  return (
    <div>
      <PageHeader
        title="Обращения"
        subtitle={isManager ? "Входящие обращения всех сотрудников" : "Ваши обращения и обращения ваших клиентов"}
        actions={
          <Link href="/requests/new" className="btn btn-primary">
            + Обращение
          </Link>
        }
      />
      <FilterBar action="/requests" resetHref="/requests">
        <FilterField label="Поиск: контакт, клиент, итог" className="w-56">
          <input name="q" defaultValue={sp.q ?? ""} className="input" />
        </FilterField>
        <FilterField label="С даты">
          <input type="date" name="from" defaultValue={sp.from ?? ""} className="input" />
        </FilterField>
        <FilterField label="По дату">
          <input type="date" name="to" defaultValue={sp.to ?? ""} className="input" />
        </FilterField>
        <FilterField label="Источник">
          <Select name="sourceCode" value={sp.sourceCode} placeholder="Все" options={dictOptions(dicts, "lead_source", sp.sourceCode)} />
        </FilterField>
        <FilterField label="Канал">
          <Select name="channelCode" value={sp.channelCode} placeholder="Все" options={dictOptions(dicts, "lead_channel", sp.channelCode)} />
        </FilterField>
        <FilterField label="Результат">
          <Select name="resultCode" value={sp.resultCode} placeholder="Все" options={codeOptions("leadResult")} />
        </FilterField>
        <FilterField label="Статус">
          <Select name="statusCode" value={sp.statusCode} placeholder="Все" options={codeOptions("leadStatus")} />
        </FilterField>
        {users.length ? (
          <FilterField label="Ответственный">
            <Select name="responsibleUserId" value={sp.responsibleUserId} placeholder="Все" options={users} />
          </FilterField>
        ) : null}
        <div className="flex flex-col justify-end gap-1 pb-0.5 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="unprocessed" value="yes" defaultChecked={sp.unprocessed === "yes"} /> Необработанные
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="withoutNextAction" value="yes" defaultChecked={sp.withoutNextAction === "yes"} /> Без следующего действия
          </label>
        </div>
      </FilterBar>
      {res.error}
      {res.data ? (
        <Card bodyClassName="">
          {res.data.items.length === 0 ? (
            <EmptyState
              title={filtered ? "По выбранным условиям обращений нет" : "Обращений пока нет"}
              hint="Регистрируйте каждый входящий звонок или заявку — даже без продолжения: так видна реальная воронка и источники."
              action={
                <Link href="/requests/new" className="btn btn-primary">
                  Зарегистрировать обращение
                </Link>
              }
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Дата и время</th>
                  <th>Контакт / клиент</th>
                  <th>Источник</th>
                  <th>Объект / объявление</th>
                  <th>Ответственный</th>
                  <th>Итог</th>
                  <th>Следующее действие</th>
                </tr>
              </thead>
              <tbody>
                {res.data.items.map((r) => {
                  const next = r.needVisible ? r.nextAction : null;
                  return (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap">
                        <Link href={`/requests/${r.id}`} className="link font-medium">
                          {fmtDateTime(r.occurredAt)}
                        </Link>
                        <div className="mt-0.5">
                          <StatusBadge status={r.statusCode} label={labelOf("leadStatus", r.statusCode)} />
                        </div>
                      </td>
                      <td>
                        {r.client ? (
                          r.clientVisible ? (
                            <Link href={`/clients/${r.client.id}`} className="link">
                              {r.client.displayName}
                            </Link>
                          ) : (
                            <span className="text-slate-500" title="Клиент закреплён за другим сотрудником">
                              Клиент другого сотрудника
                            </span>
                          )
                        ) : (
                          <span>{r.rawContact ?? <span className="text-slate-400">не указан</span>}</span>
                        )}
                      </td>
                      <td>
                        {dictLabel(dicts, "lead_source", r.sourceCode)}
                        <div className="text-xs text-slate-500">{dictLabel(dicts, "lead_channel", r.channelCode)}</div>
                      </td>
                      <td>
                        {r.property ? (
                          <Link href={`/properties/${r.property.id}`} className="link">
                            {r.property.addressText}
                          </Link>
                        ) : null}
                        {r.advertisement ? <div className="text-xs text-slate-500">Объявление: {dictLabel(dicts, "ad_platform", r.advertisement.platformCode)}</div> : null}
                        {!r.property && !r.advertisement ? <span className="text-slate-400">—</span> : null}
                      </td>
                      <td>{r.responsible.displayName}</td>
                      <td className="max-w-80">
                        <div className="text-xs font-medium text-slate-600">{labelOf("leadResult", r.resultCode)}</div>
                        {r.summary ? <div className="line-clamp-2 text-sm">{r.summary}</div> : null}
                      </td>
                      <td>
                        {next ? (
                          <>
                            <div>{next.title}</div>
                            <div className={`text-xs ${next.dueAt < now ? "font-medium text-red-600" : "text-slate-500"}`}>{fmtDateTime(next.dueAt)}</div>
                          </>
                        ) : r.statusCode === "open" ? (
                          <Badge tone="yellow">требует решения</Badge>
                        ) : (
                          <span className="text-slate-400">нет</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <Pagination page={res.data.page} pageSize={res.data.pageSize} total={res.data.total} basePath="/requests" params={sp} />
        </Card>
      ) : null}
    </div>
  );
}
