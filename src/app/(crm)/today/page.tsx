import { ContactControl } from "../requests/contact-control";
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
  const showResponsible = view.scope !== "mine";
  const selectedUser = view.scope === "user" ? users.find((u) => u.value === sp.userId) : undefined;

  // Drill-down из счётчиков в список задач с тем же охватом.
  const taskHref = (v: "overdue" | "today" | "week") =>
    view.scope === "all" ? `/tasks?view=all&status=open` : view.scope === "user" ? `/tasks?view=${v}&responsibleUserId=${sp.userId}` : `/tasks?view=${v}`;
  const needsHref = `/needs?withoutNextAction=yes${view.scope === "user" ? `&responsibleUserId=${sp.userId}` : ""}`;

  const overdueControls: ControlItem[] = [];
  const groups = GROUPS.map((g) => {
    const controls = view.controls[g].filter((c) => {
      if (c.overdue) overdueControls.push(c);
      return !c.overdue;
    });
    return { key: g, label: TODAY_GROUP_LABELS[g], tasks: view.today[g], controls };
  });
  const plannedGroups = groups.filter((g) => g.tasks.length || g.controls.length);
  const hasOverdue = view.overdue.length > 0 || overdueControls.length > 0;

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

      <ContactControl actor={actor} userId={view.scope === "mine" ? actor.userId : view.scope === "user" ? sp.userId : undefined} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TodayCounter label="Просрочено" value={view.counters.overdue} href={taskHref("overdue")} tone="red" />
        <TodayCounter label="На сегодня" value={view.counters.today} href={taskHref("today")} tone="blue" />
        <TodayCounter label="Ближайшие 7 дней" value={view.counters.week} href={taskHref("week")} tone="gray" />
        <TodayCounter
          label="Потребности без следующего действия"
          value={view.counters.needsWithoutNextAction}
          href={needsHref}
          tone="yellow"
          hint="Активные потребности без открытой задачи и приостановленные без задачи возврата"
        />
      </div>

      <TodayAgenda actor={actor} employee={view.scope === "user" ? sp.userId : actor.userId} />

      {hasOverdue ? (
        <Card
          className="mb-4 border-red-200"
          bodyClassName=""
          title={<span className="text-red-700">Просрочено · {view.overdue.length + overdueControls.length}</span>}
        >
          {view.overdue.length ? <TaskRows tasks={view.overdue} withOpen compact /> : null}
          {overdueControls.length ? (
            <>
              <div className="border-t border-slate-100 bg-slate-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Контрольные даты</div>
              <ControlRows items={overdueControls} showResponsible={showResponsible} />
            </>
          ) : null}
        </Card>
      ) : null}

      <h2 className="mb-2 text-sm font-semibold text-slate-700">На сегодня</h2>
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
            <Card key={g.key} bodyClassName="" title={`${g.label} · ${g.tasks.length + g.controls.length}`}>
              {g.tasks.length ? <TaskRows tasks={g.tasks} withOpen compact /> : null}
              {g.controls.length ? (
                <>
                  {g.tasks.length ? <div className="border-t border-slate-100" /> : null}
                  <ControlRows items={g.controls} showResponsible={showResponsible} />
                </>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      <TaskList
        title={`Ближайшие 7 дней · ${view.week.length}`}
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
