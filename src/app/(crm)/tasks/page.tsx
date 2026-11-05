import Link from "next/link";
import { requirePageActor } from "@/server/page-auth";
import { listTasks } from "@/modules/tasks/application/task-queries";
import { searchParamsToObject } from "@/shared/validation";
import { optionsOf } from "@/shared/codebook";
import { userOptions } from "@/server/options";
import { loadList } from "@/server/list-page";
import { Card, EmptyState, FilterBar, FilterField, PageHeader, Pagination, Select } from "@/ui/components";
import { TaskTable } from "@/ui/domain/task-list";
import { BulkTasks } from "./bulk-tasks";
import { tz } from "@/server/format";

export const metadata = { title: "Задачи" };

const VIEWS = [
  { key: "mine", label: "Мои" },
  { key: "overdue", label: "Просроченные" },
  { key: "today", label: "Сегодня" },
  { key: "week", label: "Неделя" },
  { key: "all", label: "Все", managerOnly: true },
] as const;

const EMPTY_HINT: Record<string, string> = {
  mine: "Открытых задач нет. Создайте задачу или зафиксируйте следующий шаг из карточки клиента/потребности.",
  overdue: "Просроченных задач нет — все сроки соблюдены.",
  today: "На сегодня задач больше нет. Проверьте ближайшие дни во вкладке «Неделя».",
  week: "На ближайшие 7 дней задач нет.",
  all: "Задачи по выбранным условиям не найдены.",
};

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageActor();
  const isManager = actor.role === "manager";
  const sp = searchParamsToObject(await searchParams);
  if (!isManager && sp.view === "all") sp.view = "mine";
  const view = sp.view ?? "mine";
  const res = await loadList(() => listTasks(actor, sp), "/tasks");
  const users = isManager ? await userOptions() : [];
  const filtered = Boolean(sp.q || sp.taskType || sp.responsibleUserId || (sp.status && sp.status !== "open"));

  // Переключение режима сохраняет остальные фильтры, но сбрасывает страницу.
  const viewHref = (key: string) => {
    const p = new URLSearchParams({ ...sp, view: key });
    p.delete("page");
    if (key === "mine") p.delete("view");
    return `/tasks${p.size ? `?${p.toString()}` : ""}`;
  };

  return (
    <div>
      <PageHeader
        title="Задачи"
        subtitle={isManager ? "Задачи сотрудников, контрольные и повторяющиеся действия" : "Ваши задачи, звонки и контрольные действия"}
        actions={
          <><Link href="/calendar" className="btn">Планер</Link><BulkTasks timeZone={tz()} /><a className="btn" href={`/api/v1/export/tasks?${new URLSearchParams(sp)}`}>CSV по фильтрам</a><Link href="/tasks/new" className="btn btn-primary">+ Новая задача</Link></>
        }
      />
      <nav className="mb-3 flex gap-1 border-b border-slate-200" aria-label="Режим списка задач">
        {VIEWS.filter((v) => !("managerOnly" in v) || isManager).map((v) => {
          const active = v.key === view;
          return (
            <Link
              key={v.key}
              href={viewHref(v.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${active ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
              aria-current={active ? "page" : undefined}
            >
              {v.label}
            </Link>
          );
        })}
      </nav>
      <FilterBar action="/tasks" resetHref={view === "mine" ? "/tasks" : `/tasks?view=${view}`}>
        {view !== "mine" ? <input type="hidden" name="view" value={view} /> : null}
        <FilterField label="Поиск по заголовку" className="w-64">
          <input name="q" defaultValue={sp.q ?? ""} className="input" placeholder="Например, договор" />
        </FilterField>
        {["overdue", "today", "week"].includes(view) ? null : (
          <FilterField label="Статус">
            <Select
              name="status"
              value={sp.status}
              options={[
                { value: "open", label: "Открытые" },
                { value: "completed", label: "Выполненные" },
                { value: "cancelled", label: "Отменённые" },
                { value: "all", label: "Все" },
              ]}
            />
          </FilterField>
        )}
        <FilterField label="Тип">
          <Select name="taskType" value={sp.taskType} placeholder="Любой" options={optionsOf("taskType")} />
        </FilterField>
        {isManager ? (
          <FilterField label="Ответственный">
            <Select name="responsibleUserId" value={sp.responsibleUserId} placeholder={view === "all" ? "Все сотрудники" : "Я"} options={users} />
          </FilterField>
        ) : null}
      </FilterBar>
      {res.error}
      {res.data ? (
        <Card bodyClassName="">
          {res.data.items.length === 0 ? (
            <EmptyState
              title={filtered ? "Задачи не найдены" : "Задач нет"}
              hint={filtered ? "Измените условия фильтра или сбросьте их." : EMPTY_HINT[view]}
              action={
                <Link href="/tasks/new" className="btn btn-primary">
                  + Новая задача
                </Link>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <TaskTable tasks={res.data.items} />
            </div>
          )}
          <Pagination page={res.data.page} pageSize={res.data.pageSize} total={res.data.total} basePath="/tasks" params={sp} />
        </Card>
      ) : null}
    </div>
  );
}
