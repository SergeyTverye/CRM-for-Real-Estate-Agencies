import Link from "next/link";
import { requirePageActor } from "@/server/page-auth";
import { listAuditFacets, listAuditLog } from "@/modules/audit/application/audit-queries";
import { listUsers } from "@/modules/users/application/users-service";
import { searchParamsToObject } from "@/shared/validation";
import { fmtDateTime } from "@/server/format";
import { loadList } from "@/server/list-page";
import { Card, EmptyState, FilterBar, FilterField, PageHeader, Pagination, Select } from "@/ui/components";

export const metadata = { title: "Журнал аудита" };

const ENTITY_LABELS: Record<string, string> = {
  Agreement: "Договор",
  Client: "Клиент",
  ClientNeed: "Потребность",
  CommercialOffer: "КП",
  Deal: "Сделка",
  DictionaryItem: "Справочник",
  Document: "Документ",
  Export: "Экспорт",
  ImportJob: "Импорт",
  LeadRequest: "Обращение",
  LegalEntity: "Юр. субъект",
  Property: "Объект",
  Task: "Задача",
  User: "Пользователь",
};

const ACTION_LABELS: Record<string, string> = {
  "agreement.archived": "Договор в архив",
  "agreement.critical_changed": "Изменены ключевые условия договора",
  "agreement.signed": "Договор подписан",
  "client.archived": "Клиент в архив",
  "client.contact_removed": "Удалён контакт клиента",
  "client.created_despite_duplicate": "Клиент создан при совпадении контакта",
  "client.responsible_changed": "Сменён ответственный за клиента",
  "client.restored": "Клиент восстановлен из архива",
  "client.status_changed": "Изменён статус клиента",
  "data.exported": "Экспорт данных",
  "deal.closed": "Сделка закрыта",
  "deal.commission_added": "Добавлена комиссия",
  "deal.commission_changed": "Изменена комиссия",
  "deal.created": "Сделка создана",
  "deal.party_added": "Добавлен участник сделки",
  "deal.party_removed": "Убран участник сделки",
  "deal.updated": "Сделка изменена",
  "dictionary.created": "Добавлено значение справочника",
  "dictionary.updated": "Изменено значение справочника",
  "document.archived": "Документ в архив",
  "import.committed": "Импорт загружен",
  "lead_request.duplicate_escalated": "Обращение передано руководителю (дубль)",
  "lead_request.resolved": "Решение по обращению",
  "legal_entity.created": "Юр. субъект создан",
  "legal_entity.renamed": "Юр. субъект переименован",
  "legal_entity.activated": "Юр. субъект активирован",
  "legal_entity.deactivated": "Юр. субъект деактивирован",
  "need.responsible_changed": "Сменён ответственный за потребность",
  "offer.status_changed": "Изменён статус КП",
  "owner_contacts.granted": "Выдан доступ к контактам собственника",
  "owner_contacts.revoked": "Отозван доступ к контактам собственника",
  "property.archive_status_changed": "Объект: архив / восстановление",
  "property.owner_removed": "Убран собственник объекта",
  "property.responsible_changed": "Сменён ответственный за объект",
  "task.due_changed": "Перенесён срок постсделочной задачи",
  "task.postdeal_created": "Создана постсделочная задача",
  "task.responsible_changed": "Сменён ответственный за задачу",
  "user.activated": "Учётная запись восстановлена",
  "user.created": "Создана учётная запись",
  "user.deactivated": "Учётная запись деактивирована",
  "user.password_changed": "Пользователь сменил пароль",
  "user.password_reset": "Сброшен пароль",
  "user.renamed": "Изменено имя пользователя",
  "user.role_changed": "Изменена роль",
};

const GROUP_LABELS: Record<string, string> = {
  agreement: "договоры",
  client: "клиенты",
  deal: "сделки",
  dictionary: "справочники",
  legal_entity: "юр. субъекты",
  owner_contacts: "доступ к контактам собственника",
  property: "объекты",
  task: "задачи",
  user: "пользователи",
};

function entityHref(type: string, id: string): string | null {
  switch (type) {
    case "Property":
      return `/properties/${id}`;
    case "Client":
      return `/clients/${id}`;
    case "ClientNeed":
      return `/needs/${id}`;
    case "Task":
      return `/tasks/${id}`;
    case "Deal":
      return `/deals/${id}`;
    case "Agreement":
      return `/agreements/${id}`;
    case "CommercialOffer":
      return `/offers/${id}`;
    case "LeadRequest":
      return `/requests/${id}`;
    case "User":
      return "/admin/users";
    case "DictionaryItem":
      return "/admin/dictionaries";
    case "LegalEntity":
      return "/admin/legal-entities";
    default:
      return null;
  }
}

/** before/after: идентификаторы сотрудников заменяются именами для читаемости. */
function JsonCell({ value, names }: { value: unknown; names: Map<string, string> }) {
  if (value === null || value === undefined) return <span className="text-slate-400">—</span>;
  const replacer = (_k: string, v: unknown) => (typeof v === "string" && names.has(v) ? names.get(v) : v);
  const text = JSON.stringify(value, replacer, 1);
  const flat = JSON.stringify(value, replacer);
  const short = flat.length > 140 ? `${flat.slice(0, 140)}…` : flat;
  if (flat.length <= 140) return <code className="break-all text-xs text-slate-700">{short}</code>;
  return (
    <details>
      <summary className="cursor-pointer break-all text-xs text-slate-700">{short}</summary>
      <pre className="mt-1 max-h-64 overflow-auto rounded bg-slate-50 p-2 text-xs whitespace-pre-wrap">{text}</pre>
    </details>
  );
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageActor({ manager: true });
  const sp = searchParamsToObject(await searchParams);
  const res = await loadList(() => listAuditLog(actor, sp), "/admin/audit");
  const [facets, users] = await Promise.all([listAuditFacets(actor), listUsers(actor)]);
  const groups = [...new Set(facets.actions.map((a) => a.split(".")[0]!))].filter((g) => facets.actions.filter((a) => a.startsWith(`${g}.`)).length > 1);
  const actionOptions = [
    ...groups.map((g) => ({ value: `${g}.`, label: `Все: ${GROUP_LABELS[g] ?? g}` })),
    ...facets.actions.map((a) => ({ value: a, label: ACTION_LABELS[a] ?? a })),
  ];
  const filtered = Object.keys(sp).some((k) => !["page", "pageSize"].includes(k));
  const names = new Map(users.map((u) => [u.id, u.displayName]));

  return (
    <div>
      <PageHeader
        title="Журнал аудита"
        back={{ href: "/admin", label: "Администрирование" }}
        subtitle="Только просмотр. Фиксируются права доступа, ответственные, архивирование, роли, справочники, сделки и критичные даты. Пароли и секреты не записываются."
      />
      <FilterBar action="/admin/audit" resetHref="/admin/audit">
        <FilterField label="Тип записи">
          <Select name="entityType" value={sp.entityType} placeholder="Любой" options={facets.entityTypes.map((t) => ({ value: t, label: ENTITY_LABELS[t] ?? t }))} />
        </FilterField>
        <FilterField label="Действие" className="w-72">
          <Select name="action" value={sp.action} placeholder="Любое" options={actionOptions} />
        </FilterField>
        <FilterField label="Кто изменил">
          <Select
            name="actorUserId"
            value={sp.actorUserId}
            placeholder="Любой сотрудник"
            options={users.map((u) => ({ value: u.id, label: `${u.displayName}${u.isActive ? "" : " (деактивирован)"}` }))}
          />
        </FilterField>
        <FilterField label="С даты">
          <input type="date" name="from" defaultValue={sp.from ?? ""} className="input" />
        </FilterField>
        <FilterField label="По дату">
          <input type="date" name="to" defaultValue={sp.to ?? ""} className="input" />
        </FilterField>
        <FilterField label="ID записи" className="w-72">
          <input name="entityId" defaultValue={sp.entityId ?? ""} className="input font-mono text-xs" placeholder="uuid" />
        </FilterField>
      </FilterBar>
      {res.error}
      {res.data ? (
        <Card bodyClassName="">
          {res.data.items.length === 0 ? (
            <EmptyState
              title={filtered ? "Записей не найдено" : "Журнал пуст"}
              hint={filtered ? "Измените фильтры или расширьте период." : "Записи появятся после критичных изменений: смены ролей, ответственных, выдачи доступа, архивирования."}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Время</th>
                    <th>Сотрудник</th>
                    <th>Действие</th>
                    <th>Запись</th>
                    <th>Было</th>
                    <th>Стало</th>
                  </tr>
                </thead>
                <tbody>
                  {res.data.items.map((r) => {
                    const href = entityHref(r.entityType, r.entityId);
                    return (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap" title={r.correlationId ? `Код запроса: ${r.correlationId}` : undefined}>
                          {fmtDateTime(r.occurredAt)}
                        </td>
                        <td>{r.actor ? r.actor.displayName : <span className="text-slate-400">система</span>}</td>
                        <td>
                          <div>{ACTION_LABELS[r.action] ?? r.action}</div>
                          <div className="font-mono text-xs text-slate-400">{r.action}</div>
                        </td>
                        <td className="whitespace-nowrap">
                          <div>{ENTITY_LABELS[r.entityType] ?? r.entityType}</div>
                          <div className="flex gap-2 text-xs">
                            {href ? (
                              <Link href={href} className="link">
                                открыть
                              </Link>
                            ) : null}
                            <Link href={`/admin/audit?entityId=${r.entityId}`} className="link" title={r.entityId}>
                              история записи
                            </Link>
                          </div>
                        </td>
                        <td className="max-w-72">
                          <JsonCell value={r.before} names={names} />
                        </td>
                        <td className="max-w-72">
                          <JsonCell value={r.after} names={names} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={res.data.page} pageSize={res.data.pageSize} total={res.data.total} basePath="/admin/audit" params={sp} />
        </Card>
      ) : null}
    </div>
  );
}
