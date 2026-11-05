import Link from "next/link";
import { labelOf, type Code } from "@/shared/codebook";
import type { TaskView } from "@/modules/tasks/application/task-queries";
import { nextRecurrenceDue } from "@/modules/tasks/domain/task-rules";
import { fmtDateOnly, fmtDateTime, tz } from "@/server/format";
import { Badge, Card, EmptyState, StatusBadge } from "../components";
import { TaskQuickActions } from "./task-actions";

const UNIT: Record<string, string> = { daily: "дн.", weekly: "нед.", monthly: "мес.", yearly: "г." };

const isOpen = (status: string) => status === "planned" || status === "in_progress";

/** Правило повторения словами: «Ежемесячно», «Каждые 2 нед., до 31.12.2026». */
export function describeRecurrence(t: Pick<TaskView, "recurrenceKind" | "recurrenceInterval" | "recurrenceUntil">): string | null {
  if (t.recurrenceKind === "none") return null;
  const base = t.recurrenceInterval > 1 ? `Каждые ${t.recurrenceInterval} ${UNIT[t.recurrenceKind] ?? ""}` : labelOf("recurrenceKind", t.recurrenceKind);
  return t.recurrenceUntil ? `${base}, до ${fmtDateOnly(t.recurrenceUntil)}` : base;
}

/** Срок следующего экземпляра повторяемой открытой задачи (создаётся при её завершении). */
export function nextInstanceDue(t: Pick<TaskView, "status" | "dueAt" | "recurrenceKind" | "recurrenceInterval" | "recurrenceUntil">): Date | null {
  if (!isOpen(t.status)) return null;
  return nextRecurrenceDue(t.dueAt, t.recurrenceKind as Code<"recurrenceKind">, t.recurrenceInterval, t.recurrenceUntil);
}

function TaskLinks({ links }: { links: TaskView["links"] }) {
  return (
    <>
      {links.map((l, i) => (
        <span key={`${l.kind}-${l.id}`}>
          {i ? ", " : ""}
          {l.href ? (
            <Link className="link" href={l.href}>
              {l.label}
            </Link>
          ) : (
            l.label
          )}
        </span>
      ))}
    </>
  );
}

/** Строки задач без обрамления — для встраивания в группы экрана «Сегодня». */
export function TaskRows({ tasks, showLinks = true, compact = false, withOpen = false }: { tasks: TaskView[]; showLinks?: boolean; compact?: boolean; withOpen?: boolean }) {
  const zone = tz();
  return (
    <ul className="divide-y divide-slate-100">
      {tasks.map((t) => {
        const open = isOpen(t.status);
        const rule = describeRecurrence(t);
        return (
          <li key={t.id} className={`flex flex-col items-start justify-between gap-2 px-4 sm:flex-row sm:flex-wrap ${compact ? "py-2" : "py-2.5"}`}>
            <div className="w-full min-w-0 sm:w-auto sm:flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/tasks/${t.id}`} className="font-medium text-slate-900 hover:underline">
                  {t.title}
                </Link>
                <Badge>{labelOf("taskType", t.taskType)}</Badge>
                {t.taskSubtypeCode ? <Badge tone="blue">{labelOf("postdealSubtype", t.taskSubtypeCode)}</Badge> : null}
                {t.priority === "high" ? <Badge tone="red">высокий</Badge> : null}
                {rule ? (
                  <Badge tone="yellow" title="Повторяемая задача">
                    {rule}
                  </Badge>
                ) : null}
                {!open ? <StatusBadge status={t.status} label={labelOf("taskStatus", t.status)} /> : null}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                <span className={t.overdue ? "font-medium text-red-600" : ""}>
                  {t.overdue ? "Просрочено: " : "Срок: "}
                  {fmtDateTime(t.dueAt)}
                </span>
                <span> · {t.responsible.displayName}</span>
                {showLinks && t.links.length ? (
                  <span>
                    {" · "}
                    <TaskLinks links={t.links} />
                  </span>
                ) : null}
              </div>
              {t.resultComment ? <div className="mt-0.5 text-xs text-slate-600">Итог: {t.resultComment}</div> : null}
            </div>
            {open ? <TaskQuickActions taskId={t.id} updatedAt={t.updatedAt.toISOString()} dueAt={t.dueAt.toISOString()} timeZone={zone} openHref={withOpen ? `/tasks/${t.id}` : undefined} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Список задач для карточек и экрана «Сегодня» (серверный компонент). */
export function TaskList({
  tasks,
  emptyHint,
  emptyAction,
  newHref,
  title,
  showLinks = true,
  compact = false,
  withOpen = false,
  footer,
}: {
  tasks: TaskView[];
  emptyHint?: string;
  emptyAction?: React.ReactNode;
  newHref?: string;
  title?: React.ReactNode;
  showLinks?: boolean;
  compact?: boolean;
  /** Показывать кнопку «Открыть» в быстрых действиях. */
  withOpen?: boolean;
  footer?: React.ReactNode;
}) {
  return (
    <Card
      title={title}
      bodyClassName=""
      actions={
        newHref ? (
          <Link href={newHref} className="btn btn-sm">
            + Задача
          </Link>
        ) : undefined
      }
    >
      {tasks.length === 0 ? <EmptyState title={emptyHint ?? "Задач нет"} action={emptyAction} /> : <TaskRows tasks={tasks} showLinks={showLinks} compact={compact} withOpen={withOpen} />}
      {footer}
    </Card>
  );
}

/** Табличное представление раздела «Задачи» (ТЗ 37.9): все обязательные колонки. */
export function TaskTable({ tasks }: { tasks: TaskView[] }) {
  const zone = tz();
  return (
    <table className="table mobile-card-table" role="table">
      <thead>
        <tr>
          <th>Задача и связи</th>
          <th>Тип</th>
          <th>Срок</th>
          <th>Ответственный</th>
          <th>Приоритет</th>
          <th>Статус</th>
          <th>Повтор</th>
          <th className="w-0" aria-label="Действия" />
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => {
          const open = isOpen(t.status);
          const rule = describeRecurrence(t);
          const nextDue = nextInstanceDue(t);
          return (
            <tr key={t.id}>
              <td data-label="Задача и связи" className="min-w-64">
                <Link href={`/tasks/${t.id}`} className="link font-medium">
                  {t.title}
                </Link>
                {t.links.length ? (
                  <div className="mt-0.5 text-xs text-slate-500">
                    <TaskLinks links={t.links} />
                  </div>
                ) : null}
                {t.resultComment ? <div className="mt-0.5 text-xs text-slate-600">Итог: {t.resultComment}</div> : null}
              </td>
              <td data-label="Тип">
                {labelOf("taskType", t.taskType)}
                {t.taskSubtypeCode ? <div className="text-xs text-slate-500">{labelOf("postdealSubtype", t.taskSubtypeCode)}</div> : null}
              </td>
              <td data-label="Срок" className={`whitespace-nowrap ${t.overdue ? "font-medium text-red-600" : ""}`}>
                {fmtDateTime(t.dueAt)}
                {t.overdue ? <div className="text-xs">просрочено</div> : null}
                {t.completedAt ? <div className="text-xs text-slate-500">завершена {fmtDateTime(t.completedAt)}</div> : null}
              </td>
              <td data-label="Ответственный">{t.responsible.displayName}</td>
              <td data-label="Приоритет">{t.priority === "high" ? <Badge tone="red">Высокий</Badge> : labelOf("taskPriority", t.priority)}</td>
              <td data-label="Статус">
                <StatusBadge status={t.status} label={labelOf("taskStatus", t.status)} />
              </td>
              <td data-label="Повтор" className="text-xs">
                {rule ?? <span className="text-slate-400">—</span>}
                {nextDue ? <div className="text-slate-500">след.: {fmtDateTime(nextDue)}</div> : null}
              </td>
              <td data-label="Действия">{open ? <TaskQuickActions taskId={t.id} updatedAt={t.updatedAt.toISOString()} dueAt={t.dueAt.toISOString()} timeZone={zone} /> : null}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
