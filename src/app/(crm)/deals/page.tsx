import Link from "next/link";
import { requirePageActor } from "@/server/page-auth";
import { listDeals } from "@/modules/deals/application/deal-service";
import { searchParamsToObject } from "@/shared/validation";
import { labelOf } from "@/shared/codebook";
import { fmtDate, fmtMoney } from "@/server/format";
import { codeOptions, userOptions } from "@/server/options";
import { loadList } from "@/server/list-page";
import { Card, EmptyState, FilterBar, FilterField, PageHeader, Pagination, Select, StatusBadge } from "@/ui/components";
import { ViewTabs, sumMoney } from "@/ui/domain/deal-list-kit";
import { legalEntityOptions } from "@/ui/domain/deal-prefill";

export const metadata = { title: "Сделки" };

const OPEN_DEFAULT = "yes";

export default async function DealsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageActor();
  const sp = searchParamsToObject(await searchParams);
  // По умолчанию — рабочие (незакрытые) сделки. «Все» — open=all.
  const openView = sp.open ?? OPEN_DEFAULT;
  const query = { ...sp, open: openView === "all" ? undefined : openView };
  const res = await loadList(() => listDeals(actor, query), "/deals");
  const isManager = actor.role === "manager";
  const [users, legalEntities] = await Promise.all([isManager ? userOptions() : Promise.resolve([]), legalEntityOptions()]);

  return (
    <div>
      <PageHeader
        title="Сделки"
        subtitle={isManager ? "Сделки агентства: участники, юрлицо, комиссии и постсделочное сопровождение" : "Ваши сделки и сделки ваших клиентов"}
        actions={
          <>
            <a className="btn" href={`/api/v1/export/deals?${new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => typeof e[1] === "string"))}`}>CSV по фильтрам</a>
            <Link href="/deals/new" className="btn btn-primary">+ Сделка</Link>
          </>
        }
      />
      <ViewTabs
        basePath="/deals"
        params={sp}
        param="open"
        defaultKey={OPEN_DEFAULT}
        current={openView}
        views={[
          { key: "yes", label: "В работе" },
          { key: "no", label: "Закрытые" },
          { key: "all", label: "Все" },
        ]}
      />
      <FilterBar action="/deals" resetHref={sp.open ? `/deals?open=${sp.open}` : "/deals"}>
        {sp.open ? <input type="hidden" name="open" value={sp.open} /> : null}
        <FilterField label="Объект / внешний участник" className="w-64">
          <input name="q" defaultValue={sp.q ?? ""} className="input" placeholder="Адрес или наименование" />
        </FilterField>
        <FilterField label="Статус">
          <Select name="status" value={sp.status} placeholder="Все" options={codeOptions("dealStatus")} />
        </FilterField>
        <FilterField label="ИП/ООО">
          <Select name="legalEntityId" value={sp.legalEntityId} placeholder="Все" options={legalEntities} />
        </FilterField>
        {users.length ? (
          <FilterField label="Ответственный">
            <Select name="responsibleUserId" value={sp.responsibleUserId} placeholder="Все" options={users} />
          </FilterField>
        ) : null}
        <FilterField label="Открыта с">
          <input type="date" name="from" defaultValue={sp.from ?? ""} className="input" />
        </FilterField>
        <FilterField label="по">
          <input type="date" name="to" defaultValue={sp.to ?? ""} className="input" />
        </FilterField>
      </FilterBar>
      {res.error}
      {res.data ? (
        <Card bodyClassName="">
          {res.data.items.length === 0 ? (
            <EmptyState
              title={openView === "yes" && Object.keys(sp).length === 0 ? "Сделок в работе нет" : "Сделки не найдены"}
              hint="Сделка открывается по объекту с участниками, юрлицом агентства и комиссиями; при закрытии система предложит постсделочные задачи."
              action={
                <Link href="/deals/new" className="btn btn-primary">
                  Открыть сделку
                </Link>
              }
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Объект</th>
                  <th>Участники</th>
                  <th>Статус</th>
                  <th>Цена</th>
                  <th>Комиссии</th>
                  <th>ИП/ООО</th>
                  <th>Ответственный</th>
                  <th>Открыта</th>
                </tr>
              </thead>
              <tbody>
                {res.data.items.map((d) => {
                  const active = d.commissions.filter((c) => !["waived", "cancelled"].includes(c.status));
                  const received = active.filter((c) => c.status === "received");
                  return (
                    <tr key={d.id}>
                      <td>
                        <Link href={`/deals/${d.id}`} className="link font-medium">
                          {d.property.addressText}
                        </Link>
                      </td>
                      <td className="text-xs">
                        {d.parties.map((p, i) => (
                          <div key={i}>
                            <span className="text-slate-500">{labelOf("dealPartyRole", p.partyRole)}:</span>{" "}
                            {p.clientId ? (
                              <Link className="link" href={`/clients/${p.clientId}`}>
                                {p.name}
                              </Link>
                            ) : (
                              <span>{p.name}</span>
                            )}
                          </div>
                        ))}
                      </td>
                      <td>
                        <StatusBadge status={d.status} label={labelOf("dealStatus", d.status)} />
                        {d.closedAt ? <div className="text-xs text-slate-500">закрыта {fmtDate(d.closedAt)}</div> : null}
                      </td>
                      <td className="whitespace-nowrap">{fmtMoney(d.dealPrice)}</td>
                      <td className="whitespace-nowrap">
                        {active.length ? (
                          <>
                            <div>{fmtMoney(sumMoney(active.map((c) => c.amount)))}</div>
                            <div className="text-xs text-slate-500">
                              получено: {fmtMoney(sumMoney(received.map((c) => c.amount)))}
                              {active.some((c) => c.status === "partially_received") ? " + частично" : ""}
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td>{d.legalEntity.displayName}</td>
                      <td>{d.responsible.displayName}</td>
                      <td className="whitespace-nowrap">{fmtDate(d.openedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <Pagination page={res.data.page} pageSize={res.data.pageSize} total={res.data.total} basePath="/deals" params={sp} />
        </Card>
      ) : null}
    </div>
  );
}
