import { getContactControl } from "@/modules/requests/application/contact-control";
import { fmtDateTime } from "@/server/format";
import Link from "next/link";
import { TodayAgenda } from "../calendar/today-agenda";
import { requirePageActor } from "@/server/page-auth";
import { getTodayView, type ControlItem, type TodayView } from "@/modules/tasks/application/task-queries";
import { TODAY_GROUP_LABELS, type TodayGroup } from "@/modules/tasks/domain/task-rules";
import { searchParamsToObject } from "@/shared/validation";
import { ValidationError } from "@/shared/errors";
import { userOptions } from "@/server/options";
import { Card, EmptyState, FilterBar, FilterField, PageHeader, Select } from "@/ui/components";
import { TaskList, TaskRows } from "@/ui/domain/task-list";
import { ControlRows, TodayCounter } from "@/ui/domain/today-blocks";

export const metadata = { title: "Сегодня" };

const GROUPS: TodayGroup[] = ["calls", "meetings", "offers", "documents", "advertising", "other"];

export default async function TodayPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageActor();
  const isManager = actor.role === "manager";
  const sp = searchParamsToObject(await searchParams);
  const filters = isManager ? { scope: sp.scope, userId: sp.userId } : {};
  let view: TodayView;
  let filterError = false;
  try {
    view = await getTodayView(actor, filters);
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
    filterError = true;
    view = await getTodayView(actor, {});
  }
  const users = isManager ? await userOptions() : [];
  const contact = await getContactControl(actor, view.scope === "mine" ? actor.userId : view.scope === "user" ? sp.userId : undefined);
  const showResponsible = view.scope !== "mine";
  const selectedUser = view.scope === "user" ? users.find((u) => u.value === sp.userId) : undefined;

  // Drill-down из счётчиков в список задач с тем же охватом.
  const taskHref = (v: "overdue" | "today" | "week") =>
    view.scope === "all" ? `/today?scope=all#${v}` : view.scope === "user" ? `/tasks?view=${v}&responsibleUserId=${sp.userId}` : `/tasks?view=${v}`;
  const needsHref = `/needs?withoutNextAction=yes${view.scope === "user" ? `&responsibleUserId=${sp.userId}` : ""}`;

  const overdueControls: ControlItem[] = [];
  const groups = GROUPS.map((g) => {
    const controls = view.controls[g].filter((c) => {
      if (c.overdue) overdueControls.push(c);
      return !c.overdue;
    });
    return { key: g, label: TODAY_GROUP_LABELS[g], tasks: view.today[g], controls };
  });
  const plannedGroups = groups.filter((g) => g.tasks.length);
  const hasOverdue = view.counters.overdue > 0;

  return (
    <div>
      <PageHeader
        title="Сегодня"
        subtitle={
          view.scope === "all"
            ? "Действия всех сотрудников"
            : view.scope === "user"
              ? `Действия сотрудника: ${selectedUser?.label ?? "—"}`
              : `Ваши действия, ${actor.displayName}`
        }
        actions={
          <>
            <Link href="/calendar" className="btn">Планер: день / неделя / месяц / три месяца</Link>
            <Link href="/requests/new" className="btn btn-primary">
              + Обращение
            </Link>
            <Link href="/tasks/new" className="btn">
              + Задача
            </Link>
            {isManager ? (
              <Link href="/today/overview" className="btn">
                Обзор руководителя
              </Link>
            ) : null}
          </>
        }
      />

      {isManager ? (
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="inline-flex overflow-hidden rounded-md border border-slate-300" role="group" aria-label="Охват">
            <Link href="/today" className={`px-3 py-1.5 text-sm ${view.scope === "mine" ? "bg-brand-600 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`} aria-current={view.scope === "mine" ? "page" : undefined}>
              Мои
            </Link>
            <Link href="/today?scope=all" className={`border-l border-slate-300 px-3 py-1.5 text-sm ${view.scope === "all" ? "bg-brand-600 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`} aria-current={view.scope === "all" ? "page" : undefined}>
              Все
            </Link>
          </div>
          <FilterBar action="/today" resetHref={view.scope === "user" ? "/today" : undefined}>
            <FilterField label="Сотрудник">
              <Select name="userId" value={view.scope === "user" ? sp.userId : undefined} placeholder="—" options={users} />
            </FilterField>
          </FilterBar>
        </div>
      ) : null}
      {filterError ? <div className="alert alert-warning mb-3">Некорректный фильтр сотрудника — показаны ваши действия.</div> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TodayCounter label="Просрочено" value={view.counters.overdue} href={taskHref("overdue")} tone="red" />
        <TodayCounter label="На сегодня" value={view.counters.today} href={taskHref("today")} tone="blue" />
        <TodayCounter label="Перспективные без действия" value={contact.requests.length} href="#prospective" tone="yellow" />
        <TodayCounter label="Показы сегодня" value={view.counters.showingsToday} href="#showings-today" tone="gray" />
      </div>
      <p className="mb-3 text-xs text-slate-500">«Просрочено» и «На сегодня» считают открытые задачи по сроку. Показы и контрольные даты приведены отдельно. Счётчик в шапке всегда относится к вашим задачам.</p>

      {hasOverdue ? (
        <Card
          className="mb-4 border-red-200"
          bodyClassName="max-h-96 overflow-y-auto"
          title={<span id="overdue" className="text-red-700">Просрочено · {view.counters.overdue}</span>}
        >
          {view.overdue.length ? <TaskRows tasks={view.overdue} withOpen compact /> : null}
          {view.counters.overdue > view.overdue.length ? <p className="px-4 py-2 text-sm">Показаны первые {view.overdue.length}. <Link className="link" href={view.scope === "all" ? "/tasks?view=all&overdueOnly=yes" : taskHref("overdue")}>Все просроченные задачи →</Link></p> : null}
        </Card>
      ) : null}

      <section id="prospective" className="mb-4"><Card title={`Перспективные без действия · ${contact.requests.length}`}>{contact.requests.length ? <ul className="max-h-72 divide-y overflow-auto">{contact.requests.map(r => <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2"><div><Link className="link font-medium" href={`/requests/${r.id}`}>{r.client?.displayName ?? "Перспективное обращение"}</Link><p className="text-xs text-slate-500">{fmtDateTime(r.occurredAt)} · {r.responsible.displayName}</p></div><Link className="btn btn-sm" href={`/requests/${r.id}`}>Назначить действие</Link></li>)}</ul> : <p className="text-sm text-slate-500">Все перспективные обращения имеют актуальное действие.</p>}</Card></section>
      <h2 id="today" className="mb-2 text-sm font-semibold text-slate-700">На сегодня · {view.counters.today}</h2>
      {plannedGroups.length === 0 ? (
        <Card className="mb-4">
          <EmptyState
            title={hasOverdue ? "Плановых действий на сегодня больше нет" : "На сегодня действий нет"}
            hint={
              hasOverdue
                ? "Разберите просроченные действия выше: выполните их или перенесите срок."
                : "Зарегистрируйте входящее обращение, назначьте следующий шаг по потребности или запланируйте звонок."
            }
            action={
              <div className="flex gap-2">
                <Link href="/requests/new" className="btn btn-primary">
                  Зарегистрировать обращение
                </Link>
                <Link href="/tasks/new" className="btn">
                  Запланировать задачу
                </Link>
              </div>
            }
          />
        </Card>
      ) : (
        <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {plannedGroups.map((g) => (
            <Card key={g.key} bodyClassName="" title={`${g.label} · ${g.tasks.length}`}>
              {g.tasks.length ? <TaskRows tasks={g.tasks} withOpen compact /> : null}
            </Card>
          ))}
        </div>
      )}

      {view.counters.today > Object.values(view.today).flat().length ? <p className="mb-4 text-sm text-slate-500">Показаны первые 200 задач на сегодня из {view.counters.today}.</p> : null}
      <section id="showings-today" className="mb-4"><Card title={`Показы сегодня · ${view.counters.showingsToday}`} bodyClassName=""><ControlRows items={view.showingsToday} showResponsible={showResponsible} />{view.counters.showingsToday > view.showingsToday.length ? <p className="p-4 text-sm text-slate-500">Показаны первые {view.showingsToday.length} показов из {view.counters.showingsToday}.</p> : null}{!view.counters.showingsToday ? <p className="p-4 text-sm text-slate-500">На сегодня показы не назначены.</p> : null}</Card></section>
      <TodayAgenda actor={actor} employee={view.scope === "all" ? "" : view.scope === "user" ? sp.userId : actor.userId} />
      <Card className="mb-4" bodyClassName="" title="Контрольные даты: договоры, реклама, КП и прошедшие показы">
        <ControlRows items={[...overdueControls, ...groups.flatMap(g => g.controls)].filter(c => c.kind !== "showing" || c.overdue)} showResponsible={showResponsible} />
      </Card>
      {view.counters.needsWithoutNextAction ? <p className="alert alert-warning mb-4"><Link className="link" href={needsHref}>Потребности без следующего действия · {view.counters.needsWithoutNextAction}</Link></p> : null}
      <TaskList
        footer={view.counters.week > view.week.length ? <p className="p-4 text-sm text-slate-500">Показаны первые {view.week.length} задач из {view.counters.week}.</p> : undefined}
        title={<span id="week">После сегодня, ближайшие 7 дней · {view.counters.week}</span>}
        tasks={view.week}
        compact
        withOpen
        emptyHint="На ближайшую неделю задач нет"
        emptyAction={
          <Link href="/tasks/new" className="btn btn-sm">
            + Запланировать
          </Link>
        }
      />
    </div>
  );
}
