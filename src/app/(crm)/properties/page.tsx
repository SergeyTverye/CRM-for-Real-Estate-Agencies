import Link from "next/link";
import { requirePageActor } from "@/server/page-auth";
import { distinctDistricts, listProperties } from "@/modules/properties/application/property-queries";
import { dictLabel } from "@/modules/dictionaries/application/dictionaries-service";
import { searchParamsToObject } from "@/shared/validation";
import { labelOf } from "@/shared/codebook";
import { fmtDateOnly, fmtMoney, fmtNum } from "@/server/format";
import { codeOptions, dictOptions, loadDictionaries, userOptions } from "@/server/options";
import { loadList } from "@/server/list-page";
import { Badge, Card, EmptyState, FilterBar, FilterField, PageHeader, Pagination, Select, StatusBadge } from "@/ui/components";

export const metadata = { title: "Объекты" };

const DAY = 86_400_000;

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageActor();
  const sp = searchParamsToObject(await searchParams);
  const res = await loadList(() => listProperties(actor, sp), "/properties");
  const [dicts, users, districts] = await Promise.all([loadDictionaries(), userOptions(), distinctDistricts()]);
  const filtered = Object.keys(sp).some((k) => !["page", "pageSize", "sort", "status"].includes(k));
  const now = new Date();

  return (
    <div>
      <PageHeader
        title="Объекты"
        subtitle="Общий каталог агентства и внешнего рынка. Контакты собственников — только в карточке объекта при наличии доступа."
        actions={
          <Link href="/properties/new" className="btn btn-primary">
            + Новый объект
          </Link>
        }
      />
      <FilterBar action="/properties" resetHref="/properties">
        <FilterField label="Адрес, район, описание" className="w-64">
          <input name="q" defaultValue={sp.q ?? ""} className="input" placeholder="Например, Ленина 10" />
        </FilterField>
        <FilterField label="Операция">
          <Select name="operationType" value={sp.operationType} placeholder="Любая" options={dictOptions(dicts, "property_operation_type")} />
        </FilterField>
        <FilterField label="Тип">
          <Select name="propertyType" value={sp.propertyType} placeholder="Любой" options={dictOptions(dicts, "property_type")} />
        </FilterField>
        <FilterField label="Подтип">
          <Select name="propertySubtype" value={sp.propertySubtype} placeholder="Любой" options={dictOptions(dicts, "property_subtype")} />
        </FilterField>
        <FilterField label="Происхождение">
          <Select name="sourceType" value={sp.sourceType} placeholder="Любое" options={codeOptions("propertySourceType")} />
        </FilterField>
        <FilterField label="Район" className="w-40">
          <input name="district" defaultValue={sp.district ?? ""} className="input" list="filter-districts" />
          <datalist id="filter-districts">
            {districts.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </FilterField>
        <FilterField label="Площадь, м²">
          <span className="flex gap-1">
            <input name="areaMin" defaultValue={sp.areaMin ?? ""} className="input w-20" placeholder="от" inputMode="decimal" />
            <input name="areaMax" defaultValue={sp.areaMax ?? ""} className="input w-20" placeholder="до" inputMode="decimal" />
          </span>
        </FilterField>
        <FilterField label="Цена, ₽">
          <span className="flex gap-1">
            <input name="priceMin" defaultValue={sp.priceMin ?? ""} className="input w-28" placeholder="от" inputMode="decimal" />
            <input name="priceMax" defaultValue={sp.priceMax ?? ""} className="input w-28" placeholder="до" inputMode="decimal" />
          </span>
        </FilterField>
        <FilterField label="Комнат от">
          <input name="roomsMin" defaultValue={sp.roomsMin ?? ""} className="input w-20" inputMode="numeric" />
        </FilterField>
        <FilterField label="Статус">
          <Select
            name="status"
            value={sp.status ?? "working"}
            options={[{ value: "working", label: "В работе (черновик, активен, приост.)" }, ...codeOptions("propertyStatus"), { value: "all", label: "Все" }]}
          />
        </FilterField>
        <FilterField label="Ответственный">
          <Select name="responsibleUserId" value={sp.responsibleUserId} placeholder="Любой" options={users} />
        </FilterField>
        <FilterField label="Реклама">
          <Select
            name="advertising"
            value={sp.advertising}
            placeholder="Не важно"
            options={[
              { value: "active", label: "Есть активная" },
              { value: "none", label: "Нет активной" },
              { value: "expiring", label: "Истекает в 14 дней" },
            ]}
          />
        </FilterField>
        <FilterField label="Сортировка">
          <Select
            name="sort"
            value={sp.sort}
            options={[
              { value: "updated_desc", label: "Недавно изменённые" },
              { value: "price_asc", label: "Цена ↑" },
              { value: "price_desc", label: "Цена ↓" },
              { value: "area_desc", label: "Площадь ↓" },
              { value: "address", label: "По адресу" },
            ]}
          />
        </FilterField>
        <label className="flex items-center gap-1.5 self-center pt-4 text-sm">
          <input type="checkbox" name="mine" value="yes" defaultChecked={sp.mine === "yes"} /> Только мои
        </label>
      </FilterBar>
      {res.error}
      {res.data ? (
        <Card bodyClassName="">
          {res.data.items.length === 0 ? (
            <EmptyState
              title={filtered ? "Объекты не найдены" : "Объектов пока нет"}
              hint={filtered ? "Измените условия фильтра или сбросьте их." : "Добавьте объект агентства или объект внешнего рынка для подбора."}
              action={
                <Link href="/properties/new" className="btn btn-primary">
                  + Новый объект
                </Link>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Адрес</th>
                    <th>Тип</th>
                    <th>Происхождение</th>
                    <th className="text-right">Площадь</th>
                    <th className="text-right">Цена</th>
                    <th>Ответственный</th>
                    <th>Статус</th>
                    <th>Реклама / договор</th>
                  </tr>
                </thead>
                <tbody>
                  {res.data.items.map((p) => {
                    const ad = p.advertisements[0];
                    const adExpiring = ad?.expiresAt ? ad.expiresAt.getTime() - now.getTime() < 14 * DAY : false;
                    const agreement = p.agreements[0];
                    return (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/properties/${p.id}`} className="link font-medium">
                            {p.addressText}
                          </Link>
                          {p.district ? <div className="text-xs text-slate-500">{p.district}</div> : null}
                        </td>
                        <td>
                          {dictLabel(dicts, "property_operation_type", p.operationType)} · {dictLabel(dicts, "property_type", p.propertyType)}
                          {p.propertySubtype || p.roomsCount !== null ? (
                            <div className="text-xs text-slate-500">
                              {p.propertySubtype ? dictLabel(dicts, "property_subtype", p.propertySubtype) : ""}
                              {p.roomsCount !== null ? `${p.propertySubtype ? ", " : ""}${p.roomsCount} комн.` : ""}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {p.sourceType === "external_market" ? <Badge tone="yellow">внешний рынок</Badge> : <Badge tone="blue">агентство</Badge>}
                          {p.sourceType === "external_market" && p.sourcePlatformCode ? (
                            <div className="mt-0.5 text-xs text-slate-500">{dictLabel(dicts, "ad_platform", p.sourcePlatformCode)}</div>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap text-right">{p.area ? fmtNum(p.area, "м²") : "—"}</td>
                        <td className="whitespace-nowrap text-right">{fmtMoney(p.price)}</td>
                        <td>{p.responsible?.displayName ?? <span className="text-slate-400">не назначен</span>}</td>
                        <td>
                          <StatusBadge status={p.status} label={labelOf("propertyStatus", p.status)} />
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {ad ? (
                              <Badge tone={adExpiring ? "yellow" : "green"} title="Активное объявление">
                                реклама{ad.expiresAt ? ` до ${fmtDateOnly(ad.expiresAt)}` : ""}
                              </Badge>
                            ) : (
                              <Badge>без рекламы</Badge>
                            )}
                            {agreement ? (
                              <Badge tone="green" title="Подписанный договор">
                                договор{agreement.validUntil ? ` до ${fmtDateOnly(agreement.validUntil)}` : ""}
                              </Badge>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={res.data.page} pageSize={res.data.pageSize} total={res.data.total} basePath="/properties" params={sp} />
        </Card>
      ) : null}
    </div>
  );
}
