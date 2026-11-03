import { Fragment } from "react";
import Link from "next/link";
import { requirePageActor } from "@/server/page-auth";
import { listAdvertisements } from "@/modules/advertisements/application/advertisement-service";
import { dictLabel } from "@/modules/dictionaries/application/dictionaries-service";
import { getConfig } from "@/shared/config/env";
import { searchParamsToObject } from "@/shared/validation";
import { labelOf } from "@/shared/codebook";
import { fmtDate, fmtDateOnly, fmtDateTime } from "@/server/format";
import { codeOptions, dictOptions, loadDictionaries, userOptions } from "@/server/options";
import { loadList } from "@/server/list-page";
import { Badge, Card, EmptyState, FilterBar, FilterField, PageHeader, Pagination, Select, StatusBadge } from "@/ui/components";
import { ViewTabs } from "@/ui/domain/deal-list-kit";
import { AdQuickActions } from "@/ui/domain/ad-quick-actions";

export const metadata = { title: "Реклама" };

type AdRow = Awaited<ReturnType<typeof listAdvertisements>>["items"][number];

export default async function AdvertisementsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageActor();
  const sp = searchParamsToObject(await searchParams);
  const res = await loadList(() => listAdvertisements(actor, sp), "/advertisements");
  const isManager = actor.role === "manager";
  const [dicts, users] = await Promise.all([loadDictionaries(), isManager ? userOptions() : Promise.resolve([{ value: actor.userId, label: "Мои объявления" }])]);
  const view = sp.view ?? "all";
  const checkDays = getConfig().AD_CHECK_INTERVAL_DAYS;

  // Группировка вокруг объекта (ТЗ 37.12): список уже отсортирован по адресу.
  const groups: { property: AdRow["property"]; items: AdRow[] }[] = [];
  for (const ad of res.data?.items ?? []) {
    const last = groups[groups.length - 1];
    if (last && last.property.id === ad.property.id) last.items.push(ad);
    else groups.push({ property: ad.property, items: [ad] });
  }

  return (
    <div>
      <PageHeader
        title="Реклама"
        subtitle={`Объявления по объектам: площадка, ссылка, статус и контроль актуальности (проверка каждые ${checkDays} дн.)`}
        actions={
          <Link href="/advertisements/new" className="btn btn-primary">
            + Объявление
          </Link>
        }
      />
      <ViewTabs
        basePath="/advertisements"
        params={sp}
        current={view}
        views={[
          { key: "all", label: "Все" },
          { key: "check_overdue", label: "Проверка просрочена" },
          { key: "expiring", label: "Истекают (14 дн.)" },
          { key: "expired", label: "Истекли" },
        ]}
      />
      <FilterBar action="/advertisements" resetHref={view !== "all" ? `/advertisements?view=${view}` : "/advertisements"}>
        {view !== "all" ? <input type="hidden" name="view" value={view} /> : null}
        <FilterField label="Поиск: адрес, текст, ссылка" className="w-64">
          <input name="q" defaultValue={sp.q ?? ""} className="input" />
        </FilterField>
        <FilterField label="Площадка">
          <Select name="platformCode" value={sp.platformCode} placeholder="Все" options={dictOptions(dicts, "ad_platform", sp.platformCode)} />
        </FilterField>
        <FilterField label="Статус">
          <Select name="status" value={sp.status} placeholder="Все" options={codeOptions("advertisementStatus")} />
        </FilterField>
        <FilterField label="Ответственный">
          <Select name="responsibleUserId" value={sp.responsibleUserId} placeholder="Все" options={users} />
        </FilterField>
      </FilterBar>
      {res.error}
      {res.data ? (
        <Card bodyClassName="">
          {res.data.items.length === 0 ? (
            <EmptyState
              title={view === "all" && !sp.q && !sp.status && !sp.platformCode ? "Объявлений пока нет" : "Объявлений по условиям нет"}
              hint="Объявление добавляется из карточки объекта агентства или здесь: укажите площадку, ссылку и рабочий текст."
              action={
                <Link href="/advertisements/new" className="btn btn-primary">
                  Добавить объявление
                </Link>
              }
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Площадка</th>
                  <th>Ссылка</th>
                  <th>Статус</th>
                  <th>Опубликовано</th>
                  <th>Проверено</th>
                  <th>Активно до</th>
                  <th>Ответственный</th>
                  <th className="w-0" aria-label="Действия" />
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={`${g.property.id}-${g.items[0]!.id}`}>
                    <tr>
                      <td colSpan={8} className="bg-slate-50/80">
                        <div className="flex items-center justify-between gap-2">
                          <Link href={`/properties/${g.property.id}`} className="font-semibold text-slate-800 hover:underline">
                            {g.property.addressText}
                          </Link>
                          <Link href={`/advertisements/new?propertyId=${g.property.id}`} className="btn btn-sm btn-link">
                            + объявление
                          </Link>
                        </div>
                      </td>
                    </tr>
                    {g.items.map((ad) => (
                      <tr key={ad.id}>
                        <td className="pl-6">
                          <Link href={`/advertisements/${ad.id}`} className="link font-medium">
                            {dictLabel(dicts, "ad_platform", ad.platformCode)}
                          </Link>
                          {ad.comment ? <div className="max-w-48 truncate text-xs text-slate-500">{ad.comment}</div> : null}
                        </td>
                        <td className="max-w-56">
                          {ad.url ? (
                            <a href={ad.url} target="_blank" rel="noopener noreferrer" className="link block truncate" title={ad.url}>
                              {ad.url.replace(/^https?:\/\//, "")}
                            </a>
                          ) : (
                            <span className="text-slate-400">нет ссылки</span>
                          )}
                        </td>
                        <td>
                          <StatusBadge status={ad.status} label={labelOf("advertisementStatus", ad.status)} />
                        </td>
                        <td className="whitespace-nowrap">{ad.publishedAt ? fmtDate(ad.publishedAt) : "—"}</td>
                        <td className="whitespace-nowrap">
                          <span className={ad.checkOverdue ? "font-medium text-red-600" : ""}>{ad.lastCheckedAt ? fmtDateTime(ad.lastCheckedAt) : "не проверялось"}</span>
                          {ad.status === "active" ? (
                            <div className="text-xs text-slate-500">
                              {ad.checkOverdue ? <Badge tone="red">проверка просрочена</Badge> : ad.nextCheckAt ? `след.: ${fmtDate(ad.nextCheckAt)}` : null}
                            </div>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap">
                          {ad.expiresAt ? <span className={ad.isExpired ? "font-medium text-red-600" : ""}>{fmtDateOnly(ad.expiresAt)}</span> : "—"}
                          {ad.isExpired && ad.status === "active" ? (
                            <div>
                              <Badge tone="red">срок истёк</Badge>
                            </div>
                          ) : null}
                        </td>
                        <td>{ad.responsible?.displayName ?? "—"}</td>
                        <td>{ad.canEdit ? <AdQuickActions adId={ad.id} updatedAt={ad.updatedAt.toISOString()} status={ad.status} canCheck={ad.status === "active"} /> : null}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
          <Pagination page={res.data.page} pageSize={res.data.pageSize} total={res.data.total} basePath="/advertisements" params={sp} />
        </Card>
      ) : null}
    </div>
  );
}
