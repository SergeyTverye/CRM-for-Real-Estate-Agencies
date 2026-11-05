import { CallNoteButton } from "@/ui/domain/ai-p2-drafts";
import { p2Available } from "@/modules/ai/application/p2-service";
import Link from "next/link";
import { NeedSelectionPanel } from "../../property-search/need-selection-panel";
import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/page-auth";
import { getNeedCard } from "@/modules/needs/application/need-queries";
import { NotFoundError } from "@/shared/errors";
import { isCode, labelOf } from "@/shared/codebook";
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, tz } from "@/server/format";
import { dictOptions, loadDictionaries, userOptions } from "@/server/options";
import { dictLabel } from "@/modules/dictionaries/application/dictionaries-service";
import { Badge, Card, Dl, EmptyState, PageHeader, StatusBadge, Tabs } from "@/ui/components";
import { ActionButton, QuickFormButton } from "@/ui/client-kit";
import { TaskList } from "@/ui/domain/task-list";
import { TaskQuickActions } from "@/ui/domain/task-actions";
import { NeedParamsSummary, needTitle } from "@/ui/domain/need-params-summary";
import { NeedStateActions } from "@/ui/domain/need-state-actions";
import { NeedCommunicationButton } from "@/ui/domain/need-communication-form";

export const metadata = { title: "Потребность" };

const HISTORY_REASON: Record<string, string> = {
  opened: "Создание потребности",
  communication: "По итогам коммуникации",
  "auto:property_proposed": "Автоматически: предложены объекты",
};

function reasonLabel(code: string | null): string {
  if (!code) return "—";
  if (HISTORY_REASON[code]) return HISTORY_REASON[code];
  if (isCode("stopReason", code)) return labelOf("stopReason", code);
  if (code.startsWith("auto:")) return "Автоматически";
  return code;
}

function transition(from: string | null, to: string | null, render: (c: string | null) => string): string {
  if (!to || from === to) return render(to ?? from);
  return from ? `${render(from)} → ${render(to)}` : render(to);
}

export default async function NeedCardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const actor = await requirePageActor();
  const aiEnabled = await p2Available(actor);
  const { id } = await params;
  const { tab = "matches" } = await searchParams;
  let card;
  try {
    card = await getNeedCard(actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { need, clientVisible, tasks } = card;
  const dicts = await loadDictionaries();
  const isManager = actor.role === "manager";
  const users = isManager ? await userOptions() : [];
  const zone = tz();
  const base = `/needs/${id}`;
  const updatedAt = need.updatedAt.toISOString();
  const openTasks = tasks.filter((t) => t.status === "planned" || t.status === "in_progress").sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const isOpen = need.status === "active" || need.status === "paused";
  const primary = clientVisible && need.client ? need.client.contacts[0] : undefined;
  const rejectionOptions = dictOptions(dicts, "match_rejection_reason");
  const channels = dictOptions(dicts, "lead_channel");
  const newTaskHref = clientVisible && need.client ? `/tasks/new?needId=${id}&clientId=${need.client.id}` : `/tasks/new?needId=${id}`;

  return (
    <div>
      <PageHeader
        back={{ href: "/needs", label: "Потребности" }}
        title={needTitle(dicts, need)}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {clientVisible && need.client ? (
              <Link href={`/clients/${need.client.id}`} className="link font-medium">
                {need.client.displayName}
              </Link>
            ) : (
              <span title="Клиент закреплён за другим сотрудником">Клиент другого сотрудника</span>
            )}
            {primary ? <span>{primary.rawValue}</span> : null}
            <StatusBadge status={need.status} label={labelOf("needStatus", need.status)} />
            <Badge tone="blue">{labelOf("needStage", need.stage)}</Badge>
            <span>· ответственный: {need.responsible.displayName}</span>
          </span>
        }
        actions={
          <>
            <CallNoteButton timeZone={zone} context={{kind:"need",id}} enabled={aiEnabled && clientVisible} />
            <Link className="btn btn-primary" href={`${base}/matching`}>
              Подбор объектов
            </Link>
            {clientVisible && need.client ? (
              <NeedCommunicationButton
                clientId={need.client.id}
                needId={id}
                needUpdatedAt={updatedAt}
                needStatus={need.status}
                needStage={need.stage}
                timeZone={zone}
                channels={channels}
                users={users.length ? users : undefined}
                label="Звонок/контакт"
              />
            ) : null}
            {isOpen ? (
              <Link className="btn" href={`/showings/new?needId=${id}`}>
                + Показ
              </Link>
            ) : null}
            <Link className="btn" href={`/offers/new?needId=${id}`}>
              + КП
            </Link>
            <Link className="btn" href={`${base}/edit`}>
              Изменить параметры
            </Link>
          </>
        }
      />
      <NeedSelectionPanel actor={actor} needId={id} />

      {need.client?.status === "archived" && clientVisible && need.client ? <div className="alert alert-warning mb-3">Клиент в архиве.</div> : null}

      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <Card title="Следующее действие" className={need.status === "active" && openTasks.length === 0 ? "border-red-300" : "border-brand-100"}>
            {need.status === "closed" ? (
              <div className="space-y-1">
                <div>
                  <span className="font-medium">Закрыта {fmtDate(need.closedAt)}.</span> Причина: {labelOf("stopReason", need.stopReasonCode)}
                </div>
                {need.stopComment ? <div className="whitespace-pre-line text-sm text-slate-600">{need.stopComment}</div> : null}
                <div className="text-xs text-slate-500">Чтобы продолжить работу, возобновите потребность с новым следующим действием.</div>
              </div>
            ) : need.status === "success" ? (
              <div className="space-y-1">
                <div className="font-medium text-green-700">Потребность успешно завершена {fmtDate(need.closedAt)}.</div>
                <div className="text-xs text-slate-500">Следующее действие не требуется. Постсделочные задачи ведутся в сделке.</div>
              </div>
            ) : (
              <div className="space-y-2">
                {need.status === "paused" ? (
                  <div className="alert alert-warning">
                    На паузе. Возврат к работе: <span className="font-medium">{openTasks[0] ? fmtDateTime(openTasks[0].dueAt) : "не назначен"}</span>
                  </div>
                ) : null}
                {openTasks.length === 0 ? (
                  <div className="alert alert-error flex flex-wrap items-center justify-between gap-2">
                    <span>У потребности нет запланированного действия — назначьте задачу со сроком.</span>
                    <Link href={newTaskHref} className="btn btn-sm">
                      + Задача
                    </Link>
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {openTasks.map((t) => (
                      <li key={t.id} className="flex flex-wrap items-start justify-between gap-2 py-1.5 first:pt-0 last:pb-0">
                        <div className="min-w-0">
                          <Link href={`/tasks/${t.id}`} className="font-medium text-slate-900 hover:underline">
                            {t.title}
                          </Link>
                          <span className="ml-2 text-xs text-slate-500">{labelOf("taskType", t.taskType)}</span>
                          <div className={`text-sm ${t.overdue ? "font-medium text-red-600" : "text-slate-500"}`}>
                            {t.overdue ? "Просрочено: " : "Срок: "}
                            {fmtDateTime(t.dueAt)} · {t.responsible.displayName}
                          </div>
                        </div>
                        <TaskQuickActions taskId={t.id} updatedAt={t.updatedAt.toISOString()} dueAt={t.dueAt.toISOString()} timeZone={zone} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Card>
          <Card
            title="Параметры подбора"
            actions={
              <Link className="btn btn-sm" href={`${base}/edit`}>
                Изменить
              </Link>
            }
          >
            <NeedParamsSummary need={need} dicts={dicts} />
          </Card>
        </div>
        <Card title="Состояние">
          <div className="space-y-3">
            <Dl
              items={[
                ["Статус", <StatusBadge key="s" status={need.status} label={labelOf("needStatus", need.status)} />],
                ["Этап", labelOf("needStage", need.stage)],
                ["Ответственный", need.responsible.displayName],
                ["Открыта", `${fmtDate(need.openedAt)} · ${need.creator.displayName}`],
                ...(need.closedAt ? ([["Завершена", fmtDate(need.closedAt)]] as [React.ReactNode, React.ReactNode][]) : []),
              ]}
            />
            <NeedStateActions needId={id} updatedAt={updatedAt} status={need.status} stage={need.stage} timeZone={zone} users={users.length ? users : undefined} />
            {isManager ? (
              <div className="border-t border-slate-100 pt-3">
                <QuickFormButton
                  label="Сменить ответственного"
                  title="Передача потребности"
                  url={`/api/v1/needs/${id}/reassign`}
                  timeZone={zone}
                  fields={[
                    { name: "responsibleUserId", label: "Новый ответственный", type: "select", required: true, initial: need.responsible.id, options: users },
                    { name: "comment", label: "Комментарий", type: "textarea" },
                  ]}
                />
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <Tabs
        basePath={base}
        current={tab}
        tabs={[
          { key: "matches", label: "Предложенные объекты", count: need.matches.length },
          { key: "showings", label: "Показы", count: need.showings.length },
          { key: "history", label: "История этапов", count: need.stageHistory.length },
          { key: "communications", label: "Коммуникации", count: need.communications.length },
          { key: "offers", label: "Предложения", count: need.commercialOffers.length },
          { key: "tasks", label: "Задачи", count: openTasks.length },
        ]}
      />

      {tab === "matches" ? (
        <Card
          bodyClassName=""
          title="Предложенные объекты"
          actions={
            <Link className="btn btn-sm btn-primary" href={`${base}/matching`}>
              Подобрать объекты
            </Link>
          }
        >
          {need.matches.length === 0 ? (
            <EmptyState
              title="Объекты ещё не предлагались"
              hint="Откройте рабочее место подбора: система покажет подходящие объекты каталога с объяснением совпадения."
              action={
                <Link className="btn btn-primary" href={`${base}/matching`}>
                  Перейти к подбору
                </Link>
              }
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Объект</th>
                  <th>Цена</th>
                  <th>Площадь</th>
                  <th>Предложен</th>
                  <th>Статус</th>
                  <th>Причина отказа / комментарий</th>
                  <th>Следующий шаг</th>
                </tr>
              </thead>
              <tbody>
                {need.matches.map((m) => {
                  const active = m.status === "proposed" || m.status === "interested" || m.status === "showing_planned";
                  return (
                    <tr key={m.id}>
                      <td>
                        <Link className="link" href={`/properties/${m.property.id}`}>
                          {m.property.addressText}
                        </Link>
                        <div className="text-xs text-slate-500">
                          {dictLabel(dicts, "property_type", m.property.propertyType)} · {labelOf("propertyStatus", m.property.status)}
                        </div>
                      </td>
                      <td className="whitespace-nowrap">{fmtMoney(m.property.price)}</td>
                      <td className="whitespace-nowrap">{fmtNum(m.property.area, "м²")}</td>
                      <td className="whitespace-nowrap">
                        {fmtDate(m.offeredAt)}
                        <div className="text-xs text-slate-500">{m.creator.displayName}</div>
                      </td>
                      <td>
                        <StatusBadge status={m.status} label={labelOf("matchStatus", m.status)} />
                      </td>
                      <td>
                        {m.rejectionReasonCode ? <div>{dictLabel(dicts, "match_rejection_reason", m.rejectionReasonCode)}</div> : null}
                        {m.comment ? <div className="text-xs text-slate-600">{m.comment}</div> : null}
                        {!m.rejectionReasonCode && !m.comment ? <span className="text-slate-400">—</span> : null}
                      </td>
                      <td>
                        {active && isOpen ? (
                          <div className="flex flex-wrap gap-1">
                            {m.status === "proposed" ? <ActionButton method="PATCH" url={`/api/v1/matches/${m.id}`} body={{ status: "interested" }} label="Интересен" /> : null}
                            {m.status !== "showing_planned" ? (
                              <Link className="btn btn-sm" href={`/showings/new?needId=${id}&propertyId=${m.property.id}`}>
                                Назначить показ
                              </Link>
                            ) : null}
                            <QuickFormButton
                              label="Отказ"
                              title="Клиент отказался от объекта"
                              method="PATCH"
                              url={`/api/v1/matches/${m.id}`}
                              timeZone={zone}
                              extraBody={{ status: "rejected" }}
                              fields={[
                                { name: "rejectionReasonCode", label: "Причина отказа", type: "select", required: true, initial: rejectionOptions[0]?.value ?? "", options: rejectionOptions },
                                { name: "comment", label: "Комментарий", type: "textarea" },
                              ]}
                            />
                            <ActionButton method="PATCH" url={`/api/v1/matches/${m.id}`} body={{ status: "withdrawn" }} label="Снять" className="btn btn-sm btn-link" confirm="Снять объект из подбора (например, объект уже недоступен)?" />
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      ) : null}

      {tab === "showings" ? (
        <Card
          bodyClassName=""
          title="Показы"
          actions={
            isOpen ? (
              <Link className="btn btn-sm btn-primary" href={`/showings/new?needId=${id}`}>
                + Показ
              </Link>
            ) : undefined
          }
        >
          {need.showings.length === 0 ? (
            <EmptyState title="Показов пока нет" hint="Назначьте показ по предложенному объекту — после показа зафиксируйте результат и следующий шаг." />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Объект</th>
                  <th>Статус</th>
                  <th>Результат</th>
                  <th>Ответственный</th>
                  <th>Комментарий</th>
                </tr>
              </thead>
              <tbody>
                {need.showings.map((s) => (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap">
                      <Link className="link" href={`/showings/${s.id}`}>
                        {fmtDateTime(s.occurredAt ?? s.scheduledAt)}
                      </Link>
                    </td>
                    <td>
                      <Link className="link" href={`/properties/${s.property.id}`}>
                        {s.property.addressText}
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={s.status} label={labelOf("showingStatus", s.status)} />
                    </td>
                    <td>{s.resultCode ? labelOf("showingResult", s.resultCode) : "—"}</td>
                    <td>{s.responsible.displayName}</td>
                    <td className="text-sm text-slate-600">{s.comment ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : null}

      {tab === "history" ? (
        <Card bodyClassName="" title="История этапов и статусов">
          {need.stageHistory.length === 0 ? (
            <EmptyState title="Изменений этапа ещё не было" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Когда</th>
                  <th>Этап</th>
                  <th>Статус</th>
                  <th>Основание</th>
                  <th>Комментарий</th>
                  <th>Кто</th>
                </tr>
              </thead>
              <tbody>
                {need.stageHistory.map((h) => (
                  <tr key={h.id}>
                    <td className="whitespace-nowrap">{fmtDateTime(h.occurredAt)}</td>
                    <td>{transition(h.fromStage, h.toStage, (c) => labelOf("needStage", c))}</td>
                    <td>{transition(h.fromStatus, h.toStatus, (c) => labelOf("needStatus", c))}</td>
                    <td>{reasonLabel(h.reasonCode)}</td>
                    <td className="whitespace-pre-line text-sm text-slate-600">{h.comment ?? "—"}</td>
                    <td>{h.changer.displayName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : null}

      {tab === "communications" ? (
        <Card
          bodyClassName=""
          title="Коммуникации"
          actions={
            clientVisible && need.client ? (
              <NeedCommunicationButton
                clientId={need.client.id}
                needId={id}
                needUpdatedAt={updatedAt}
                needStatus={need.status}
                needStage={need.stage}
                timeZone={zone}
                channels={channels}
                users={users.length ? users : undefined}
                buttonClassName="btn btn-sm btn-primary"
              />
            ) : undefined
          }
        >
          {need.communications.length === 0 ? (
            <EmptyState title="Коммуникаций по потребности нет" hint="Фиксируйте звонки, сообщения и встречи — они формируют историю клиента и показатель «без движения»." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {need.communications.map((c) => (
                <li key={c.id} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{fmtDateTime(c.occurredAt)}</span>
                    <Badge>{labelOf("communicationType", c.communicationType)}</Badge>
                    {c.channelCode ? <span>{dictLabel(dicts, "lead_channel", c.channelCode)}</span> : null}
                    {c.resultCode ? <span>· {labelOf("communicationResult", c.resultCode)}</span> : null}
                    <span>· {c.author.displayName}</span>
                  </div>
                  {c.comment ? <div className="mt-0.5 whitespace-pre-line text-sm">{c.comment}</div> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {tab === "offers" ? (
        <Card
          bodyClassName=""
          title="Коммерческие предложения"
          actions={
            <Link className="btn btn-sm btn-primary" href={`/offers/new?needId=${id}`}>
              + КП
            </Link>
          }
        >
          {need.commercialOffers.length === 0 ? (
            <EmptyState title="Предложений нет" hint="Коммерческое предложение собирается из объектов подбора — отметьте объекты в рабочем месте подбора." />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Предложение</th>
                  <th>Статус</th>
                  <th>Отправлено</th>
                  <th>Создано</th>
                </tr>
              </thead>
              <tbody>
                {need.commercialOffers.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link className="link" href={`/offers/${o.id}`}>
                        {o.title}
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={o.status} label={labelOf("offerStatus", o.status)} />
                    </td>
                    <td>{fmtDateTime(o.sentAt)}</td>
                    <td>{fmtDate(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : null}

      {tab === "tasks" ? <TaskList tasks={tasks} emptyHint="Задач по потребности нет" newHref={newTaskHref} /> : null}
    </div>
  );
}
