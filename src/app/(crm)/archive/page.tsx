import Link from "next/link";
import { requirePageActor } from "@/server/page-auth";
import { listArchive } from "@/modules/archive/application/archive-service";
import { searchParamsToObject } from "@/shared/validation";
import { fmtDateOnly, fmtMoney } from "@/server/format";
import { loadList } from "@/server/list-page";
import { Card, EmptyState, FilterBar, FilterField, PageHeader, Pagination, Select } from "@/ui/components";

export const metadata = { title: "Исторический архив сделок" };

export default async function ArchivePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageActor({ manager: true });
  const sp = searchParamsToObject(await searchParams);
  const res = await loadList(() => listArchive(actor, sp), "/archive");
  const filtered = Boolean(sp.q || sp.from || sp.to || sp.linked);

  return (
    <div>
      <PageHeader
        back={{ href: "/reports", label: "Отчёты" }}
        title="Исторический архив сделок"
        subtitle={`Только чтение · доступ только руководителю${res.data ? ` · записей: ${res.data.total}` : ""}`}
      />
      <div className="alert alert-info mb-3 text-sm">
        Архив перенесён из исторического реестра Excel и изолирован от оперативной CRM: в отчёты и воронку он не входит. <b>Паспортные данные, сведения о регистрации и даты рождения не переносились и не хранятся.</b>
      </div>

      <FilterBar action="/archive" resetHref="/archive">
        <FilterField label="Поиск: ФИО, адрес, телефон, риелтор" className="w-80">
          <input name="q" defaultValue={sp.q ?? ""} className="input" placeholder="Например, Иванов или ул. Ленина" />
        </FilterField>
        <FilterField label="Дата сделки с">
          <input type="date" name="from" defaultValue={sp.from ?? ""} className="input" />
        </FilterField>
        <FilterField label="по">
          <input type="date" name="to" defaultValue={sp.to ?? ""} className="input" />
        </FilterField>
        <FilterField label="Связан с клиентом CRM">
          <Select
            name="linked"
            value={sp.linked}
            placeholder="Не важно"
            options={[
              { value: "yes", label: "Связан" },
              { value: "no", label: "Не связан" },
            ]}
          />
        </FilterField>
      </FilterBar>
      {res.error}
      {res.data ? (
        <Card bodyClassName="">
          {res.data.items.length === 0 ? (
            <EmptyState
              title={filtered ? "Записи не найдены" : "Архив пуст"}
              hint={filtered ? "Измените условия поиска или сбросьте фильтры." : "Архив заполняется загрузкой секции «Исторический архив сделок» из Excel-файла предприятия."}
              action={
                filtered ? (
                  <Link href="/archive" className="btn">
                    Сбросить фильтры
                  </Link>
                ) : (
                  <Link href="/import" className="btn btn-primary">
                    Перейти к импорту
                  </Link>
                )
              }
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Дата сделки</th>
                  <th>Объект</th>
                  <th>Участник</th>
                  <th>Телефон</th>
                  <th className="text-right">Цена</th>
                  <th>Риелтор</th>
                  <th>Клиент CRM</th>
                </tr>
              </thead>
              <tbody>
                {res.data.items.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap">
                      {a.dealDate ? fmtDateOnly(a.dealDate) : (a.dealDateText ?? "—")}
                      {!a.dealDate && a.dealDateText ? <div className="text-xs text-slate-400">как в источнике</div> : null}
                    </td>
                    <td>
                      <Link href={`/archive/${a.id}`} className="link">
                        {a.objectText ?? "Без адреса"}
                      </Link>
                      {a.propertyType ? <div className="text-xs text-slate-500">{a.propertyType}</div> : null}
                    </td>
                    <td>
                      {a.participantName ?? "—"}
                      {a.partyRole ? <div className="text-xs text-slate-500">{a.partyRole}</div> : null}
                    </td>
                    <td className="whitespace-nowrap">{a.contactPhone ?? a.contactEmail ?? "—"}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{fmtMoney(a.price)}</td>
                    <td>{a.realtorText ?? "—"}</td>
                    <td>
                      {a.client ? (
                        <Link href={`/clients/${a.client.id}`} className="link">
                          {a.client.displayName}
                        </Link>
                      ) : (
                        <span className="text-slate-400">не связан</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Pagination page={res.data.page} pageSize={res.data.pageSize} total={res.data.total} basePath="/archive" params={sp} />
        </Card>
      ) : null}
    </div>
  );
}
