import Link from "next/link";
import { requirePageActor } from "@/server/page-auth";
import { listOffers } from "@/modules/commercial-offers/application/offer-service";
import { searchParamsToObject } from "@/shared/validation";
import { labelOf } from "@/shared/codebook";
import { fmtDate, fmtDateOnly } from "@/server/format";
import { codeOptions, userOptions } from "@/server/options";
import { loadList } from "@/server/list-page";
import { Card, EmptyState, FilterBar, FilterField, PageHeader, Pagination, Select, StatusBadge } from "@/ui/components";
import { FilterChip, listHref } from "@/ui/domain/deal-list-kit";

export const metadata = { title: "Коммерческие предложения" };

export default async function OffersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageActor();
  const sp = searchParamsToObject(await searchParams);
  const res = await loadList(() => listOffers(actor, sp), "/offers");
  const isManager = actor.role === "manager";
  const users = isManager ? await userOptions() : [];
  const newHref = sp.needId ? `/offers/new?needId=${sp.needId}` : "/offers/new";

  return (
    <div>
      <PageHeader
        title="Коммерческие предложения"
        subtitle="КП фиксирует подборку объектов с ценами и условиями на момент подготовки"
        actions={
          <Link href={newHref} className="btn btn-primary">
            + Предложение
          </Link>
        }
      />
      <FilterBar action="/offers" resetHref="/offers">
        {sp.needId ? <input type="hidden" name="needId" value={sp.needId} /> : null}
        <FilterField label="Поиск: заголовок, клиент" className="w-64">
          <input name="q" defaultValue={sp.q ?? ""} className="input" />
        </FilterField>
        <FilterField label="Статус">
          <Select name="status" value={sp.status} placeholder="Все" options={codeOptions("offerStatus")} />
        </FilterField>
        {users.length ? (
          <FilterField label="Ответственный">
            <Select name="responsibleUserId" value={sp.responsibleUserId} placeholder="Все" options={users} />
          </FilterField>
        ) : null}
      </FilterBar>
      {sp.needId ? (
        <div className="mb-3">
          <FilterChip label="Только по выбранной потребности" removeHref={listHref("/offers", sp, { needId: null })} />
        </div>
      ) : null}
      {res.error}
      {res.data ? (
        <Card bodyClassName="">
          {res.data.items.length === 0 ? (
            <EmptyState
              title={Object.keys(sp).length ? "Предложения не найдены" : "Предложений пока нет"}
              hint="КП создаётся по потребности клиента: выберите объекты, при необходимости уточните цену и условия, затем сформируйте документ."
              action={
                <Link href={newHref} className="btn btn-primary">
                  Создать предложение
                </Link>
              }
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Предложение</th>
                  <th>Клиент / потребность</th>
                  <th>Объектов</th>
                  <th>ИП/ООО</th>
                  <th>Статус</th>
                  <th>Отправлено</th>
                  <th>Действует до</th>
                  <th>Ответственный</th>
                </tr>
              </thead>
              <tbody>
                {res.data.items.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/offers/${o.id}`} className="link font-medium">
                        {o.title ?? "КП без заголовка"}
                      </Link>
                      <div className="text-xs text-slate-500">создано {fmtDate(o.createdAt)}</div>
                    </td>
                    <td>
                      <Link className="link" href={`/needs/${o.need.id}`}>
                        {o.clientVisible ? o.need.client?.displayName : "Клиент (нет доступа)"}
                      </Link>
                    </td>
                    <td>{o._count.items}</td>
                    <td>{o.legalEntity?.displayName ?? <span className="text-slate-400">—</span>}</td>
                    <td>
                      <StatusBadge status={o.status} label={labelOf("offerStatus", o.status)} />
                    </td>
                    <td className="whitespace-nowrap">{o.sentAt ? fmtDate(o.sentAt) : "—"}</td>
                    <td className="whitespace-nowrap">{o.expiresAt ? fmtDateOnly(o.expiresAt) : "—"}</td>
                    <td>{o.responsible.displayName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Pagination page={res.data.page} pageSize={res.data.pageSize} total={res.data.total} basePath="/offers" params={sp} />
        </Card>
      ) : null}
    </div>
  );
}
