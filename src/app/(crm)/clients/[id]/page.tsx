import { ClientTimelinePanel } from "./timeline-panel";
import { searchParamsToObject } from "@/shared/validation";
import { CallNoteButton } from "@/ui/domain/ai-p2-drafts";
import { p2Available } from "@/modules/ai/application/p2-service";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/page-auth";
import { getClientCard, getClientRecentInteractions } from "@/modules/clients/application/client-queries";
import { listTasksLinkedTo } from "@/modules/tasks/application/task-queries";
import { NotFoundError } from "@/shared/errors";
import { labelOf } from "@/shared/codebook";
import { fmtDate, fmtDateOnly, fmtDateTime, fmtMoney, tz } from "@/server/format";
import { codeOptions, loadDictionaries, userOptions } from "@/server/options";
import { dictLabel } from "@/modules/dictionaries/application/dictionaries-service";
import { Badge, Card, Dl, EmptyState, PageHeader, StatusBadge, Tabs } from "@/ui/components";
import { ActionButton, QuickFormButton } from "@/ui/client-kit";
import { TaskQuickActions } from "@/ui/domain/task-actions";
import { TaskList } from "@/ui/domain/task-list";
import { Timeline } from "@/ui/domain/timeline";
import { DocumentsPanel } from "@/ui/domain/documents-panel";

export const metadata = { title: "Клиент" };

export default async function ClientCardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageActor();
  const aiEnabled = await p2Available(actor);
  const { id } = await params;
  const filters = searchParamsToObject(await searchParams);
  const { tab = "overview" } = filters;
  let client;
  try {
    client = await getClientCard(actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const dicts = await loadDictionaries();
  const isManager = actor.role === "manager";
  const tasks = await listTasksLinkedTo(actor, { clientId: id }, { includeClosed: tab === "tasks", take: 100, includeIndirectClient: true });
  const openTasks = tasks.filter((t) => ["planned", "in_progress"].includes(t.status));
  const nearest = openTasks[0];
  const primary = client.contacts[0];
  const base = `/clients/${id}`;
  const users = isManager ? await userOptions() : [];
  const zone = tz();

  return (
    <div>
      <PageHeader
        back={{ href: "/clients", label: "Клиенты" }}
        title={client.displayName}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={client.status} label={labelOf("clientStatus", client.status)} />
            <span>{labelOf("clientKind", client.clientKind)}</span>
            <span>· ответственный: {client.responsible.displayName}</span>
            {primary ? <span>· {primary.rawValue}</span> : null}
          </span>
        }
        actions={
          <>
            <CallNoteButton timeZone={zone} context={{kind:"client",id}} enabled={aiEnabled} />
            <Link className="btn btn-primary" href={`/needs/new?clientId=${id}`}>
              + Потребность
            </Link>
            <QuickFormButton
              label="Звонок/контакт"
              title="Зафиксировать коммуникацию"
              url="/api/v1/communications"
              timeZone={zone}
              extraBody={{ clientId: id }}
              buttonClassName="btn"
              fields={[
                { name: "communicationType", label: "Тип", type: "select", required: true, initial: "call", options: codeOptions("communicationType") },
                { name: "resultCode", label: "Результат", type: "select", options: codeOptions("communicationResult") },
                { name: "comment", label: "Комментарий", type: "textarea" },
              ]}
            />
            <Link className="btn" href={`/tasks/new?clientId=${id}`}>
              + Задача
            </Link>
            <Link className="btn" href={`${base}/edit`}>
              Редактировать
            </Link>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card title="Следующее действие" actions={<Link className="btn btn-sm" href={`/tasks/new?clientId=${id}`}>+ Создать</Link>}>
          {nearest ? (
            <div>
              <Link href={`/tasks/${nearest.id}`} className="link font-medium">
                {nearest.title}
              </Link>
              <div className={`text-sm ${nearest.overdue ? "text-red-600" : "text-slate-500"}`}>
                {fmtDateTime(nearest.dueAt)} · {nearest.responsible.displayName}
              </div>
              <div className="mt-3"><TaskQuickActions taskId={nearest.id} updatedAt={nearest.updatedAt.toISOString()} dueAt={nearest.dueAt.toISOString()} timeZone={zone} /></div>
            </div>
          ) : (
            <span className="text-slate-500">Нет запланированных действий</span>
          )}
        </Card>
        <Card title="Потребности">
          <span className="text-2xl font-semibold">{client.needs.filter((n) => ["active", "paused"].includes(n.status)).length}</span>
          <span className="ml-2 text-sm text-slate-500">открытых из {client.needs.length}</span>
        </Card>
        {isManager ? (
          <Card title="Управление">
            <div className="flex flex-wrap gap-2">
              <QuickFormButton
                label="Сменить ответственного"
                title="Передача клиента"
                url={`/api/v1/clients/${id}/reassign`}
                timeZone={zone}
                fields={[
                  { name: "responsibleUserId", label: "Новый ответственный", type: "select", required: true, options: users },
                  { name: "transferOpenNeeds", label: "Передать открытые потребности", type: "checkbox", initial: true },
                  { name: "comment", label: "Комментарий", type: "textarea" },
                ]}
              />
              {client.status === "archived" ? (
                <ActionButton url={`/api/v1/clients/${id}/restore`} label="Восстановить из архива" confirm="Восстановить клиента из архива?" />
              ) : (
                <QuickFormButton
                  label="В архив"
                  title="Архивирование клиента"
                  url={`/api/v1/clients/${id}/archive`}
                  timeZone={zone}
                  buttonClassName="btn btn-sm btn-danger"
                  fields={[{ name: "comment", label: "Причина / комментарий", type: "textarea" }]}
                />
              )}
            </div>
          </Card>
        ) : null}
      </div>

      <Tabs
        basePath={base}
        current={tab}
        tabs={[
          { key: "overview", label: "Обзор" },
          { key: "needs", label: "Потребности", count: client.needs.length },
          { key: "history", label: "История" },
          { key: "tasks", label: "Задачи", count: openTasks.length },
          { key: "deals", label: "Сделки", count: client.dealParties.length },
          { key: "documents", label: "Документы" },
        ]}
      />

      {tab === "overview" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="lg:col-span-2" aria-label="Последние взаимодействия"><div className="mb-2 flex justify-between"><h2 className="font-semibold">Последние 5 взаимодействий</h2><Link className="link text-sm" href={`${base}?tab=history`}>Вся история →</Link></div><Timeline events={await getClientRecentInteractions(actor, id)} dicts={dicts} /></section>
          <Card
            title="Контакты"
            actions={
              <QuickFormButton
                label="+ Контакт"
                title="Новый контакт"
                url={`/api/v1/clients/${id}/contacts`}
                timeZone={zone}
                fields={[
                  { name: "contactType", label: "Тип", type: "select", required: true, initial: "phone", options: codeOptions("contactType") },
                  { name: "value", label: "Значение", required: true },
                  { name: "comment", label: "Комментарий" },
                ]}
              />
            }
          >
            {client.contacts.length === 0 ? (
              <span className="text-slate-500">Контактов нет</span>
            ) : (
              <ul className="space-y-1.5">
                {client.contacts.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2">
                    <span>
                      <span className="text-xs text-slate-500">{labelOf("contactType", c.contactType)}:</span> {c.rawValue}
                      {c.isPrimary ? <Badge tone="blue">основной</Badge> : null}
                      {c.contactPerson ? <span className="ml-1 text-xs text-slate-500">({c.contactPerson.fullName})</span> : null}
                      {c.comment ? <span className="ml-1 text-xs text-slate-500">— {c.comment}</span> : null}
                    </span>
                    <ActionButton method="DELETE" url={`/api/v1/clients/${id}/contacts/${c.id}`} label="Удалить" className="btn btn-sm btn-link" confirm="Удалить контакт?" />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Сведения">
            <Dl
              items={[
                ["Создан", `${fmtDate(client.createdAt)} · ${client.creator.displayName}`],
                ["Комментарий", client.notes],
                ["Объекты (собственник)", client.ownerships.length ? client.ownerships.map((o) => <div key={o.property.id}><Link className="link" href={`/properties/${o.property.id}`}>{o.property.addressText}</Link></div>) : null],
                ["Договоры", client.agreements.length ? client.agreements.map((a) => <div key={a.id}><Link className="link" href={`/agreements/${a.id}`}>{labelOf("agreementType", a.agreementType)} {a.agreementNumber ?? ""}</Link> · {labelOf("agreementStatus", a.status)} {a.validUntil ? `до ${fmtDateOnly(a.validUntil)}` : ""}</div>) : null],
              ]}
            />
          </Card>
          {client.clientKind === "organization" ? (
            <Card
              title="Контактные лица"
              actions={
                <QuickFormButton
                  label="+ Лицо"
                  title="Контактное лицо"
                  url={`/api/v1/clients/${id}/contact-persons`}
                  timeZone={zone}
                  fields={[
                    { name: "fullName", label: "ФИО", required: true },
                    { name: "position", label: "Должность" },
                  ]}
                />
              }
            >
              {client.contactPersons.length ? (
                <ul>{client.contactPersons.map((p) => <li key={p.id}>{p.fullName}{p.position ? ` — ${p.position}` : ""}</li>)}</ul>
              ) : (
                <span className="text-slate-500">Не указаны</span>
              )}
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "needs" ? (
        <Card bodyClassName="" title="Потребности клиента" actions={<Link className="btn btn-sm btn-primary" href={`/needs/new?clientId=${id}`}>+ Потребность</Link>}>
          {client.needs.length === 0 ? (
            <EmptyState title="Потребностей нет" hint="Создайте потребность с параметрами запроса и следующим действием." />
          ) : (
            <table className="table">
              <thead>
                <tr><th>Запрос</th><th>Бюджет</th><th>Этап</th><th>Статус</th><th>Ответственный</th><th>Открыта</th></tr>
              </thead>
              <tbody>
                {client.needs.map((n) => (
                  <tr key={n.id}>
                    <td><Link className="link" href={`/needs/${n.id}`}>{dictLabel(dicts, "need_operation_type", n.operationType)} · {dictLabel(dicts, "property_type", n.propertyType)}</Link>{n.district ? <div className="text-xs text-slate-500">{n.district}</div> : null}</td>
                    <td>{n.budgetMin || n.budgetMax ? `${fmtMoney(n.budgetMin)} – ${fmtMoney(n.budgetMax)}` : "—"}</td>
                    <td>{labelOf("needStage", n.stage)}</td>
                    <td><StatusBadge status={n.status} label={labelOf("needStatus", n.status)} /></td>
                    <td>{n.responsible.displayName}</td>
                    <td>{fmtDate(n.openedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : null}

      {tab === "history" ? <ClientTimelinePanel actor={actor} clientId={id} filters={filters} /> : null}
      {tab === "tasks" ? <TaskList tasks={tasks} emptyHint="Нет задач по клиенту" newHref={`/tasks/new?clientId=${id}`} /> : null}

      {tab === "deals" ? (
        <Card bodyClassName="">
          {client.dealParties.length === 0 ? (
            <EmptyState title="Сделок нет" />
          ) : (
            <table className="table">
              <thead><tr><th>Объект</th><th>Роль</th><th>Статус</th><th>Цена</th><th>Открыта</th></tr></thead>
              <tbody>
                {client.dealParties.map((p) => (
                  <tr key={p.deal.id}>
                    <td><Link className="link" href={`/deals/${p.deal.id}`}>{p.deal.property.addressText}</Link></td>
                    <td>{labelOf("dealPartyRole", p.partyRole)}</td>
                    <td><StatusBadge status={p.deal.status} label={labelOf("dealStatus", p.deal.status)} /></td>
                    <td>{fmtMoney(p.deal.dealPrice)}</td>
                    <td>{fmtDate(p.deal.openedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : null}

      {tab === "documents" ? <DocumentsPanel actor={actor} link={{ kind: "client", id }} /> : null}
    </div>
  );
}
