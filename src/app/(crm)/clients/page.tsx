import Link from "next/link";
import { requirePageActor } from "@/server/page-auth";
import { listClients } from "@/modules/clients/application/client-queries";
import { searchParamsToObject } from "@/shared/validation";
import { labelOf } from "@/shared/codebook";
import { fmtDateTime } from "@/server/format";
import { userOptions } from "@/server/options";
import { loadList } from "@/server/list-page";
import { Card, EmptyState, FilterBar, FilterField, PageHeader, Pagination, Select, StatusBadge } from "@/ui/components";

export const metadata = { title: "Клиенты" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageActor();
  const sp = searchParamsToObject(await searchParams);
  const res = await loadList(() => listClients(actor, sp), "/clients");
  const users = actor.role === "manager" ? await userOptions() : [];
  return (
    <div>
      <PageHeader
        title="Клиенты"
        subtitle={actor.role === "manager" ? "Все клиенты агентства" : "Ваши клиенты"}
        actions={
          <Link href="/clients/new" className="btn btn-primary">
            + Новый клиент
          </Link>
        }
      />
      <FilterBar action="/clients" resetHref="/clients">
        <FilterField label="Поиск: имя, телефон, e-mail" className="w-72">
          <input name="q" defaultValue={sp.q ?? ""} className="input" placeholder="Например, 912 345 или Иванов" />
        </FilterField>
        <FilterField label="Статус">
          <Select name="status" value={sp.status} options={[{ value: "all", label: "Все" }, { value: "active", label: "Активные" }, { value: "inactive", label: "Неактивные" }, { value: "archived", label: "В архиве" }]} />
        </FilterField>
        <FilterField label="Активная потребность">
          <Select name="hasActiveNeed" value={sp.hasActiveNeed} placeholder="Не важно" options={[{ value: "yes", label: "Есть" }, { value: "no", label: "Нет" }]} />
        </FilterField>
        {users.length ? (
          <FilterField label="Ответственный">
            <Select name="responsibleUserId" value={sp.responsibleUserId} placeholder="Все" options={users} />
          </FilterField>
        ) : null}
      </FilterBar>
      {res.error}
      {res.data ? (
        <Card bodyClassName="">
          {res.data.items.length === 0 ? (
            <EmptyState
              title={sp.q ? "Клиенты не найдены" : "Клиентов пока нет"}
              hint={sp.q || sp.status || sp.hasActiveNeed || sp.responsibleUserId ? "Проверьте имя или контакт, измените условия поиска либо сбросьте фильтры." : "Новые клиенты появляются при регистрации обращения или создаются вручную."}
              action={
                <Link href="/requests/new" className="btn btn-primary">
                  Зарегистрировать обращение
                </Link>
              }
            />
          ) : (
            <table className="table mobile-card-table" role="table">
              <thead>
                <tr>
                  <th>Клиент</th>
                  <th>Основной контакт</th>
                  <th>Ответственный</th>
                  <th>Потребности</th>
                  <th>Ближайшее действие</th>
                  <th>Последняя активность</th>
                  <th>Быстрые действия</th>
                </tr>
              </thead>
              <tbody>
                {res.data.items.map((c) => (
                  <tr key={c.id}>
                    <td data-label="Клиент">
                      <Link href={`/clients/${c.id}`} className="link font-medium">
                        {c.displayName}
                      </Link>
                      <div className="mt-0.5 flex gap-1">
                        <StatusBadge status={c.status} label={labelOf("clientStatus", c.status)} />
                        {c.clientKind === "organization" ? <span className="text-xs text-slate-400">организация</span> : null}
                      </div>
                    </td>
                    <td data-label="Основной контакт" className="whitespace-nowrap">{c.primaryContact ?? "—"}</td>
                    <td data-label="Ответственный">{c.responsible.displayName}</td>
                    <td data-label="Потребности">{c.activeNeeds || "—"}</td>
                    <td data-label="Ближайшее действие">
                      {c.nextAction ? (
                        <>
                          <div>{c.nextAction.title}</div>
                          <div className={`text-xs ${c.nextAction.dueAt < new Date() ? "text-red-600" : "text-slate-500"}`}>{fmtDateTime(c.nextAction.dueAt)}</div>
                        </>
                      ) : (
                        <span className="text-slate-400">нет</span>
                      )}
                    </td>
                    <td data-label="Последняя активность">{fmtDateTime(c.lastActivityAt)}</td>
                    <td data-label="Быстрые действия">
                      <div className="flex flex-wrap gap-2">
                        <Link href={`/clients/${c.id}?tab=history`} className="link" aria-label={`История клиента ${c.displayName}`}>История</Link>
                        <Link href={`/clients/${c.id}?tab=needs`} className="link" aria-label={`Потребности клиента ${c.displayName}`}>Потребности</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Pagination page={res.data.page} pageSize={res.data.pageSize} total={res.data.total} basePath="/clients" params={sp} />
        </Card>
      ) : null}
    </div>
  );
}
