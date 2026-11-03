import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/page-auth";
import { getTask, listRecurrenceSeries } from "@/modules/tasks/application/task-queries";
import { listActiveUsersBrief } from "@/modules/users/application/users-service";
import { NotFoundError } from "@/shared/errors";
import { labelOf } from "@/shared/codebook";
import { fmtDateTime, tz } from "@/server/format";
import { Badge, Card, Dl, PageHeader, StatusBadge } from "@/ui/components";
import { TaskCardActions } from "@/ui/domain/task-actions";
import { describeRecurrence, nextInstanceDue } from "@/ui/domain/task-list";

export const metadata = { title: "Задача" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TaskCardPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const task = await getTask(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const isManager = actor.role === "manager";
  const open = task.status === "planned" || task.status === "in_progress";
  const rule = describeRecurrence(task);
  const nextDue = nextInstanceDue(task);
  const series = task.recurrenceKind !== "none" || task.parentTaskId ? await listRecurrenceSeries(actor, task) : [];
  const allUsers = await listActiveUsersBrief();
  const creator = allUsers.find((u) => u.id === task.createdBy);
  const isResponsible = task.responsible.id === actor.userId;
  // Передать задачу может руководитель или её ответственный; риелтор — себе или руководителю.
  const reassignUsers =
    isManager || isResponsible
      ? allUsers
          .filter((u) => isManager || u.id === actor.userId || u.id === task.responsible.id || u.roleCode === "manager")
          .map((u) => ({ value: u.id, label: `${u.displayName}${u.roleCode === "manager" ? " — руководитель" : ""}` }))
      : null;
  if (reassignUsers && !reassignUsers.some((o) => o.value === task.responsible.id)) {
    reassignUsers.unshift({ value: task.responsible.id, label: `${task.responsible.displayName} (неактивен)` });
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        back={{ href: "/tasks", label: "Задачи" }}
        title={task.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={task.status} label={labelOf("taskStatus", task.status)} />
            <Badge>{labelOf("taskType", task.taskType)}</Badge>
            {task.taskSubtypeCode ? <Badge tone="blue">{labelOf("postdealSubtype", task.taskSubtypeCode)}</Badge> : null}
            {task.priority !== "normal" ? <Badge tone={task.priority === "high" ? "red" : "gray"}>приоритет: {labelOf("taskPriority", task.priority).toLowerCase()}</Badge> : null}
            {task.overdue ? <Badge tone="red">просрочено</Badge> : null}
          </span>
        }
        actions={
          open ? (
            <TaskCardActions
              taskId={task.id}
              updatedAt={task.updatedAt.toISOString()}
              timeZone={tz()}
              users={reassignUsers}
              initial={{
                title: task.title,
                description: task.description ?? "",
                dueAt: task.dueAt.toISOString(),
                priority: task.priority,
                status: task.status,
                responsibleUserId: task.responsible.id,
              }}
            />
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Сведения">
            <Dl
              items={[
                ["Срок", <span key="due" className={task.overdue ? "font-medium text-red-600" : ""}>{fmtDateTime(task.dueAt)}</span>],
                ["Ответственный", task.responsible.displayName],
                ["Поставил", creator?.displayName ?? "—"],
                ["Описание", task.description ? <span key="d" className="whitespace-pre-line">{task.description}</span> : null],
                ...(task.completedAt ? ([["Завершена", fmtDateTime(task.completedAt)]] as [string, string][]) : []),
                ...(task.resultComment ? ([[task.status === "cancelled" ? "Причина отмены" : "Итог", task.resultComment]] as [string, string][]) : []),
              ]}
            />
          </Card>
          <Card title="Связанные записи">
            {task.links.length === 0 ? (
              <span className="text-sm text-slate-500">Задача не связана с клиентом, потребностью или объектом.</span>
            ) : (
              <ul className="space-y-1 text-sm">
                {task.links.map((l) => (
                  <li key={`${l.kind}-${l.id}`}>
                    {l.href ? (
                      <Link href={l.href} className="link">
                        {l.label}
                      </Link>
                    ) : (
                      <span className="text-slate-500">{l.label}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Повторение">
            {rule ? (
              <div className="space-y-1 text-sm">
                <div>{rule}</div>
                {nextDue ? <div className="text-slate-500">Следующий экземпляр: {fmtDateTime(nextDue)} (создаётся при выполнении)</div> : null}
                {open && !nextDue ? <div className="text-slate-500">Это последний экземпляр серии.</div> : null}
              </div>
            ) : (
              <span className="text-sm text-slate-500">{task.parentTaskId ? "Экземпляр повторяемой серии" : "Разовая задача"}</span>
            )}
            {series.length > 1 ? (
              <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100 text-sm">
                {series.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 py-1.5">
                    {s.id === task.id ? (
                      <span className="font-medium">{fmtDateTime(s.dueAt)} (эта)</span>
                    ) : (
                      <Link href={`/tasks/${s.id}`} className="link">
                        {fmtDateTime(s.dueAt)}
                      </Link>
                    )}
                    <StatusBadge status={s.status} label={labelOf("taskStatus", s.status)} />
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
          {!open ? (
            <Card title="Дальше">
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/tasks/new${task.links.some((l) => l.href) ? `?${task.links.filter((l) => l.href).map((l) => `${l.kind}Id=${l.id}`).join("&")}` : ""}`}
                  className="btn btn-sm"
                >
                  + Следующая задача по тем же связям
                </Link>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
