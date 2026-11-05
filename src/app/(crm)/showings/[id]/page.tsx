import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/page-auth";
import { getShowing } from "@/modules/showings/application/showing-service";
import { listTasksLinkedTo } from "@/modules/tasks/application/task-queries";
import { NotFoundError } from "@/shared/errors";
import { labelOf } from "@/shared/codebook";
import { fmtDateTime, fmtMoney, fmtNum, tz } from "@/server/format";
import { userOptions } from "@/server/options";
import { Card, Dl, PageHeader, StatusBadge } from "@/ui/components";
import { QuickFormButton } from "@/ui/client-kit";
import { TaskList } from "@/ui/domain/task-list";
import { DocumentsPanel } from "@/ui/domain/documents-panel";
import { ShowingResultButton } from "@/ui/domain/showing-result-form";

export const metadata = { title: "Показ" };

export default async function ShowingCardPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor();
  const { id } = await params;
  let data;
  try {
    data = await getShowing(actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { showing: s, clientVisible } = data;
  const zone = tz();
  const isManager = actor.role === "manager";
  const users = isManager ? await userOptions() : undefined;
  const tasks = await listTasksLinkedTo(actor, { showingId: id }, { includeClosed: true, take: 50 });
  const planned = s.status === "planned";
  const needOpen = ["active", "paused"].includes(s.need.status);
  const clientName = clientVisible ? s.need.client?.displayName : "Клиент (нет доступа)";

  return (
    <div>
      <PageHeader
        back={{ href: "/showings", label: "Показы" }}
        title={`Показ: ${s.property.addressText}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={s.status} label={labelOf("showingStatus", s.status)} />
            <span>{fmtDateTime(s.scheduledAt)}</span>
            <span>· ответственный: {s.responsible.displayName}</span>
          </span>
        }
        actions={
          planned ? (
            <>
              <ShowingResultButton showingId={id} updatedAt={s.updatedAt.toISOString()} scheduledAt={s.scheduledAt.toISOString()} timeZone={zone} need={needOpen ? { status: s.need.status, stage: s.need.stage } : null} users={users} />
              <QuickFormButton
                label="Перенести"
                title="Перенос показа"
                method="PATCH"
                url={`/api/v1/showings/${id}`}
                timeZone={zone}
                buttonClassName="btn"
                extraBody={{ expectedUpdatedAt: s.updatedAt.toISOString() }}
                fields={[
                  { name: "scheduledAt", label: "Новые дата и время", type: "datetime", required: true, initial: s.scheduledAt.toISOString(), hint: "Срок задачи-встречи изменится вместе с показом" },
                  { name: "participantsText", label: "Участники", initial: s.participantsText ?? "" },
                  { name: "comment", label: "Комментарий", type: "textarea", initial: s.comment ?? "" },
                ]}
              />
            </>
          ) : (
            <Link className="btn" href={`/showings/new?needId=${s.need.id}&propertyId=${s.property.id}`}>
              Назначить повторный показ
            </Link>
          )
        }
      />

      {planned && s.scheduledAt < new Date() ? <div className="alert alert-warning mb-4">Плановое время показа прошло — зафиксируйте результат, чтобы потребность не осталась без продолжения.</div> : null}

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Показ">
          <Dl
            items={[
              ["Потребность", <Link key="n" className="link" href={`/needs/${s.need.id}`}>{clientName} · {labelOf("needStage", s.need.stage)}</Link>],
              ["Статус потребности", labelOf("needStatus", s.need.status)],
              ["Объект", <Link key="p" className="link" href={`/properties/${s.property.id}`}>{s.property.addressText}</Link>],
              ["Цена / площадь", `${fmtMoney(s.property.price)} · ${fmtNum(s.property.area, "м²")}`],
              ["Ответственный", s.responsible.displayName],
              ["Плановая дата", fmtDateTime(s.scheduledAt)],
              ["Фактическая дата", s.occurredAt ? fmtDateTime(s.occurredAt) : null],
              ["Участники", s.participantsText],
            ]}
          />
        </Card>
        <Card title="Результат">
          <Dl
            items={[
              ["Статус", <StatusBadge key="s" status={s.status} label={labelOf("showingStatus", s.status)} />],
              ["Результат", s.resultCode ? labelOf("showingResult", s.resultCode) : planned ? <span className="text-slate-400">не зафиксирован</span> : null],
              ["Комментарий", s.comment ? <span className="whitespace-pre-wrap">{s.comment}</span> : null],
              ["Назначен", `${fmtDateTime(s.createdAt)} · ${s.creator.displayName}`],
            ]}
          />
        </Card>
      </div>

      <div className="space-y-4">
        <TaskList title="Задачи по показу" tasks={tasks} emptyHint="Задач по показу нет" newHref={`/tasks/new?showingId=${id}&needId=${s.need.id}`} />
        <DocumentsPanel actor={actor} link={{ kind: "showing", id }} />
      </div>
    </div>
  );
}
