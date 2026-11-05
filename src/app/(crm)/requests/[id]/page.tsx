import { CallNoteButton } from "@/ui/domain/ai-p2-drafts";
import { p2Available } from "@/modules/ai/application/p2-service";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/page-auth";
import { getRequestCard } from "@/modules/requests/application/request-queries";
import { NotFoundError } from "@/shared/errors";
import { labelOf } from "@/shared/codebook";
import { dictLabel } from "@/modules/dictionaries/application/dictionaries-service";
import { fmtDateTime, tz } from "@/server/format";
import { loadDictionaries, userOptions } from "@/server/options";
import { Card, Dl, PageHeader, StatusBadge } from "@/ui/components";
import { ResolveRequestForm } from "./resolve-form";

export const metadata = { title: "Обращение" };

export default async function RequestCardPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor();
  const aiEnabled = await p2Available(actor);
  const { id } = await params;
  let card;
  try {
    card = await getRequestCard(actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { request: r, clientVisible, needVisible } = card;
  const dicts = await loadDictionaries();
  const isManager = actor.role === "manager";
  const users = isManager ? await userOptions() : [];
  // Контакт из обращения не показывается, если он относится к чужому клиенту.
  const showRawContact = !r.client || clientVisible;
  const escalated = r.statusCode === "open" && !r.clientId;

  return (
    <div className="max-w-5xl">
      <PageHeader
        back={{ href: "/requests", label: "Обращения" }}
        title={`Обращение от ${fmtDateTime(r.occurredAt)}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={r.statusCode} label={labelOf("leadStatus", r.statusCode)} />
            <span>{labelOf("leadResult", r.resultCode)}</span>
            <span>· {dictLabel(dicts, "lead_source", r.sourceCode)}</span>
            <span>· ответственный: {r.responsible.displayName}</span>
          </span>
        }
        actions={
          <>
            <CallNoteButton timeZone={tz()} context={{kind:"request",id}} enabled={aiEnabled && clientVisible} />
            {needVisible && r.need ? (
              <Link className="btn btn-primary" href={`/needs/${r.need.id}`}>
                Открыть потребность
              </Link>
            ) : null}
            {clientVisible && r.client ? (
              <Link className="btn" href={`/clients/${r.client.id}`}>
                Карточка клиента
              </Link>
            ) : null}
            <Link className="btn" href={clientVisible && r.client ? `/requests/new?clientId=${r.client.id}` : "/requests/new"}>
              + Ещё обращение
            </Link>
          </>
        }
      />
      {escalated ? (
        <div className="alert alert-warning mb-3">
          {isManager
            ? "Обращение ожидает решения: контакт совпал с клиентом другого сотрудника либо клиент не определён. Привяжите обращение к клиенту и назначьте ответственного."
            : "Обращение ожидает решения руководителя."}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Сведения">
          <Dl
            items={[
              ["Дата и время", fmtDateTime(r.occurredAt)],
              ["Канал", dictLabel(dicts, "lead_channel", r.channelCode)],
              ["Источник", dictLabel(dicts, "lead_source", r.sourceCode)],
              [
                "Клиент",
                r.client ? (
                  clientVisible ? (
                    <Link className="link" href={`/clients/${r.client.id}`}>
                      {r.client.displayName}
                    </Link>
                  ) : (
                    <span className="text-slate-500">Клиент другого сотрудника</span>
                  )
                ) : (
                  <span className="text-slate-500">не привязан</span>
                ),
              ],
              ["Контакт из обращения", showRawContact ? r.rawContact : null],
              [
                "Объект",
                r.property ? (
                  <span>
                    <Link className="link" href={`/properties/${r.property.id}`}>
                      {r.property.addressText}
                    </Link>
                    {r.property.responsible ? <span className="text-xs text-slate-500"> · ответственный объекта: {r.property.responsible.displayName}</span> : null}
                  </span>
                ) : null,
              ],
              [
                "Объявление",
                r.advertisement ? (
                  <span>
                    {dictLabel(dicts, "ad_platform", r.advertisement.platformCode)}
                    {r.advertisement.url ? (
                      <a className="link ml-2" href={r.advertisement.url} target="_blank" rel="noreferrer noopener">
                        ссылка
                      </a>
                    ) : null}
                  </span>
                ) : null,
              ],
              [
                "Потребность",
                r.need ? (
                  needVisible ? (
                    <span>
                      <Link className="link" href={`/needs/${r.need.id}`}>
                        {labelOf("needStage", r.need.stage)}
                      </Link>{" "}
                      <StatusBadge status={r.need.status} label={labelOf("needStatus", r.need.status)} />
                    </span>
                  ) : (
                    <span className="text-slate-500">ведёт другой сотрудник</span>
                  )
                ) : null,
              ],
              ["Результат", labelOf("leadResult", r.resultCode)],
              ["Ответственный", r.responsible.displayName],
              ["Зарегистрировал(а)", `${r.creator.displayName} · ${fmtDateTime(r.createdAt)}`],
            ]}
          />
        </Card>
        <div className="space-y-4">
          <Card title="Итог разговора">{r.summary ? <div className="whitespace-pre-line text-sm">{r.summary}</div> : <span className="text-slate-500">Не заполнен</span>}</Card>
          {isManager ? (
            <Card title="Решение руководителя">
              <ResolveRequestForm requestId={r.id} updatedAt={r.updatedAt.toISOString()} status={r.statusCode} users={users} hasClient={Boolean(r.clientId)} />
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
