import Link from "next/link";
import { requirePageActor } from "@/server/page-auth";
import { listShowings } from "@/modules/showings/application/showing-service";
import { searchParamsToObject } from "@/shared/validation";
import { labelOf } from "@/shared/codebook";
import { addDays, localDateString } from "@/shared/time";
import { fmtDateTime, tz } from "@/server/format";
import { codeOptions, userOptions } from "@/server/options";
import { loadList } from "@/server/list-page";
import { Badge, Card, EmptyState, FilterBar, FilterField, PageHeader, Pagination, Select, StatusBadge } from "@/ui/components";
import { ViewTabs, listHref } from "@/ui/domain/deal-list-kit";
import { PropertyFilterPicker } from "@/ui/domain/deal-pickers";
import { loadPropertyPick } from "@/ui/domain/deal-prefill";

export const metadata = { title: "Показы" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type ShowingRow = Awaited<ReturnType<typeof listShowings>>["items"][number];

/** Понедельник недели, в которую попадает календарная дата 'YYYY-MM-DD'. */
function weekStart(date: string): Date {
  const d = new Date(`${date}T00:00:00.000Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(d, -dow);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const dayLabel = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const timeLabel = (d: Date, zone: string) => new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: zone }).format(d);

function clientLabel(s: ShowingRow) {
  return s.clientVisible ? s.need.client.displayName : "Клиент (нет доступа)";
}

export default async function ShowingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageActor();
  const sp = searchParamsToObject(await searchParams);
  const zone = tz();
  const isManager = actor.role === "manager";
  const users = isManager ? await userOptions() : [];
  const week = sp.view === "week";
  const today = localDateString(new Date(), zone);
  const monday = weekStart(sp.date && DATE_RE.test(sp.date) ? sp.date : today);
  const days = Array.from({ length: 7 }, (_, i) => iso(addDays(monday, i)));

  // Неделя: запрос с запасом в сутки по краям (границы фильтра — даты UTC), группировка по локальной дате.
  const query: Record<string, string> = week
    ? { ...sp, from: iso(addDays(monday, -1)), to: iso(addDays(monday, 7)), status: sp.status ?? "planned", page: "1", pageSize: "200" }
    : sp;
  const res = await loadList(() => listShowings(actor, query), "/showings");

  const property = await loadPropertyPick(actor, sp.propertyId);

  const newHref = sp.propertyId ? `/showings/new?propertyId=${sp.propertyId}` : "/showings/new";
  return (
    <div>
      <PageHeader
        title="Показы"
        subtitle={isManager ? "Все показы агентства" : "Показы по вашим потребностям"}
        actions={
          <Link href={newHref} className="btn btn-primary">
            + Назначить показ
          </Link>
        }
      />
      <ViewTabs
        basePath="/showings"
        params={sp}
        param="view"
        current={week ? "week" : "all"}
        views={[
          { key: "all", label: "Список" },
          { key: "week", label: "Неделя" },
        ]}
      />
      <FilterBar action="/showings" resetHref={week ? "/showings?view=week" : "/showings"}>
        {week ? <input type="hidden" name="view" value="week" /> : null}
        {week ? <input type="hidden" name="date" value={iso(monday)} /> : null}
        <FilterField label="Статус">
          <Select name="status" value={sp.status} placeholder={week ? "Запланированные" : "Все"} options={codeOptions("showingStatus")} />
        </FilterField>
        {!week ? (
          <>
            <FilterField label="С даты">
              <input type="date" name="from" defaultValue={sp.from ?? ""} className="input" />
            </FilterField>
            <FilterField label="По дату">
              <input type="date" name="to" defaultValue={sp.to ?? ""} className="input" />
            </FilterField>
          </>
        ) : null}
        <FilterField label="Чьи">
          <Select name="mine" value={sp.mine} placeholder={isManager ? "Все" : "Все доступные"} options={[{ value: "yes", label: "Только мои" }]} />
        </FilterField>
        {users.length ? (
          <FilterField label="Ответственный">
            <Select name="responsibleUserId" value={sp.responsibleUserId} placeholder="Все" options={users} />
          </FilterField>
        ) : null}
        <FilterField label="Объект" className="w-72">
          <PropertyFilterPicker initial={property} />
        </FilterField>
      </FilterBar>
      {res.error}
      {res.data && week ? <WeekView items={res.data.items} days={days} today={today} zone={zone} params={sp} monday={monday} total={res.data.total} /> : null}
      {res.data && !week ? (
        <Card bodyClassName="">
          {res.data.items.length === 0 ? (
            <EmptyState
              title={Object.keys(sp).length ? "Показы не найдены" : "Показов пока нет"}
              hint="Показ назначается по потребности клиента и объекту; задача-встреча создаётся автоматически."
              action={
                <Link href={newHref} className="btn btn-primary">
                  Назначить показ
                </Link>
              }
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Дата и время</th>
                  <th>Объект</th>
                  <th>Клиент / потребность</th>
                  <th>Ответственный</th>
                  <th>Статус</th>
                  <th>Результат</th>
                </tr>
              </thead>
              <tbody>
                {res.data.items.map((s) => {
                  const overdue = s.status === "planned" && s.scheduledAt < new Date();
                  return (
                    <tr key={s.id}>
                      <td className="whitespace-nowrap">
                        <Link href={`/showings/${s.id}`} className="link font-medium">
                          {fmtDateTime(s.scheduledAt)}
                        </Link>
                        {overdue ? <div className="text-xs text-red-600">результат не зафиксирован</div> : null}
                      </td>
                      <td>
                        <Link href={`/properties/${s.property.id}`} className="link">
                          {s.property.addressText}
                        </Link>
                      </td>
                      <td>
                        <Link href={`/needs/${s.need.id}`} className="link">
                          {clientLabel(s)}
                        </Link>
                      </td>
                      <td>{s.responsible.displayName}</td>
                      <td>
                        <StatusBadge status={s.status} label={labelOf("showingStatus", s.status)} />
                      </td>
                      <td>
                        {s.resultCode ? <div>{labelOf("showingResult", s.resultCode)}</div> : <span className="text-slate-400">—</span>}
                        {s.comment ? <div className="max-w-xs truncate text-xs text-slate-500">{s.comment}</div> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <Pagination page={res.data.page} pageSize={res.data.pageSize} total={res.data.total} basePath="/showings" params={sp} />
        </Card>
      ) : null}
    </div>
  );
}

function WeekView({
  items,
  days,
  today,
  zone,
  params,
  monday,
  total,
}: {
  items: ShowingRow[];
  days: string[];
  today: string;
  zone: string;
  params: Record<string, string>;
  monday: Date;
  total: number;
}) {
  const byDay = new Map<string, ShowingRow[]>(days.map((d) => [d, []]));
  for (const s of [...items].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())) {
    byDay.get(localDateString(s.scheduledAt, zone))?.push(s);
  }
  const shown = [...byDay.values()].reduce((n, l) => n + l.length, 0);
  const last = addDays(monday, 6);
  return (
    <Card
      bodyClassName=""
      title={`Неделя ${dayLabel.format(monday)} — ${dayLabel.format(last)}`}
      actions={
        <>
          <Link className="btn btn-sm" href={listHref("/showings", params, { view: "week", date: iso(addDays(monday, -7)) })}>
            ← Предыдущая
          </Link>
          <Link className="btn btn-sm" href={listHref("/showings", params, { view: "week", date: null })}>
            Текущая
          </Link>
          <Link className="btn btn-sm" href={listHref("/showings", params, { view: "week", date: iso(addDays(monday, 7)) })}>
            Следующая →
          </Link>
        </>
      }
    >
      <div className="divide-y divide-slate-100">
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const isToday = d === today;
          return (
            <div key={d} className={`flex gap-4 px-4 py-2.5 ${isToday ? "bg-brand-50/40" : ""}`}>
              <div className="w-44 shrink-0 text-sm">
                <span className={isToday ? "font-semibold text-brand-700" : "font-medium text-slate-700"}>{dayLabel.format(new Date(`${d}T00:00:00.000Z`))}</span>
                {isToday ? <span className="ml-1 text-xs text-brand-700">сегодня</span> : null}
              </div>
              <div className="min-w-0 flex-1">
                {list.length === 0 ? (
                  <span className="text-sm text-slate-400">—</span>
                ) : (
                  <ul className="space-y-1">
                    {list.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <Link href={`/showings/${s.id}`} className="link w-12 font-medium">
                          {timeLabel(s.scheduledAt, zone)}
                        </Link>
                        <span className="font-medium text-slate-800">{s.property.addressText}</span>
                        <span className="text-slate-500">· {clientLabel(s)}</span>
                        <span className="text-xs text-slate-500">· {s.responsible.displayName}</span>
                        {s.status !== "planned" ? <StatusBadge status={s.status} label={labelOf("showingStatus", s.status)} /> : null}
                        {s.status === "planned" && s.scheduledAt < new Date() ? <Badge tone="red">нет результата</Badge> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {total > shown && total >= 200 ? <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Показаны первые 200 записей — уточните фильтры.</div> : null}
      {shown === 0 ? (
        <EmptyState
          title="На этой неделе показов нет"
          action={
            <Link href="/showings/new" className="btn btn-primary">
              Назначить показ
            </Link>
          }
        />
      ) : null}
    </Card>
  );
}
