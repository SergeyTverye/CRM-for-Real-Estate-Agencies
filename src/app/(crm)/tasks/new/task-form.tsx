"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "@/ui/api-client";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { Field, FormErrorBanner, SubmitButton } from "@/ui/form";
import { DisclosureSection } from "@/ui/disclosure-section";
import { DateTimeInput, EntityPicker, SelectInput, defaultNextAction, type Option } from "@/ui/client-kit";
import { optionsOf } from "@/shared/codebook";

export type LinkKind = "client" | "need" | "property" | "showing" | "deal" | "agreement" | "advertisement" | "offer";

export interface ContextLink {
  kind: LinkKind;
  id: string;
  label: string;
  kindLabel: string;
  href: string;
}

const LINK_FIELD: Record<LinkKind, string> = {
  client: "clientIds",
  need: "needIds",
  property: "propertyIds",
  showing: "showingIds",
  deal: "dealIds",
  agreement: "agreementIds",
  advertisement: "advertisementIds",
  offer: "offerIds",
};

/** Тип задачи по умолчанию по контексту, из которого она создаётся. */
const DEFAULT_TYPE: Partial<Record<LinkKind, string>> = {
  showing: "showing_or_meeting",
  agreement: "contract_check",
  advertisement: "advertising_check",
  offer: "commercial_offer",
};

const UNIT: Record<string, string> = { daily: "дн.", weekly: "нед.", monthly: "мес.", yearly: "г." };

interface Template {
  label: string;
  title: string;
  taskType: string;
  taskSubtypeCode?: string;
  recurrenceKind: string;
  hint: string;
}

/** Типовые регулярные контрольные действия (ТЗ 25.4). */
const TEMPLATES: Template[] = [
  { label: "Проверить декларацию", title: "Проверить декларацию", taskType: "postdeal", taskSubtypeCode: "tax_declaration", recurrenceKind: "yearly", hint: "Ежегодный контроль декларации." },
  { label: "Индексация аренды", title: "Индексация аренды", taskType: "postdeal", taskSubtypeCode: "rent_indexation", recurrenceKind: "yearly", hint: "Ежегодная проверка условий аренды." },
  { label: "Контроль договора", title: "Контроль договора", taskType: "contract_check", recurrenceKind: "quarterly", hint: "Контроль каждый квартал." },
  { label: "Повторный контакт", title: "Повторный контакт", taskType: "call_or_contact", recurrenceKind: "weekly", hint: "Повторный контакт каждую неделю." },
  { label: "Проверка сроков договоров", title: "Ежемесячная проверка сроков договоров", taskType: "contract_check", recurrenceKind: "monthly", hint: "Повторяется каждый месяц от выбранного срока." },
  { label: "Проверка рекламы", title: "Проверить актуальность рекламных объявлений", taskType: "advertising_check", recurrenceKind: "weekly", hint: "Повторяется каждую неделю." },
  { label: "День рождения клиента", title: "Поздравить клиента с днём рождения", taskType: "call_or_contact", recurrenceKind: "yearly", hint: "Укажите срок — дату дня рождения в этом году; задача будет повторяться ежегодно." },
  { label: "Постсделочный контакт", title: "Связаться с клиентом после сделки", taskType: "postdeal", taskSubtypeCode: "followup", recurrenceKind: "none", hint: "Постсделочное сопровождение обычно ведёт руководитель." },
];

interface PickedClient {
  id: string;
  displayName: string;
  contacts: { rawValue: string }[];
}
interface PickedProperty {
  id: string;
  addressText: string;
}

export function NewTaskForm({
  timeZone,
  users,
  selfId,
  contextLinks,
  returnHref,
  isManager,
}: {
  timeZone: string;
  isManager: boolean;
  users: Option[];
  selfId: string;
  contextLinks: ContextLink[];
  returnHref: string | null;
}) {
  const router = useRouter();
  const initialType = contextLinks.map((l) => DEFAULT_TYPE[l.kind]).find(Boolean) ?? "call_or_contact";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [taskType, setTaskType] = useState(initialType);
  const [subtype, setSubtype] = useState("");
  const [initialDueAt] = useState(() => defaultNextAction().dueAt);
  const [dueAt, setDueAt] = useState(initialDueAt);
  const [priority, setPriority] = useState("normal");
  const [responsibleUserId, setResponsible] = useState(selfId);
  const [recurrenceKind, setRecurrenceKind] = useState("none");
  const [recurrenceInterval, setRecurrenceInterval] = useState("1");
  const [recurrenceUntil, setRecurrenceUntil] = useState("");
  const [links, setLinks] = useState(contextLinks);
  const [client, setClient] = useState<PickedClient | null>(null);
  const [property, setProperty] = useState<PickedProperty | null>(null);
  const [templateHint, setTemplateHint] = useState<string | null>(null);
  const { pending, error, run, fieldError } = useApiAction();
  const dirty = title !== "" || description !== "" || taskType !== initialType || subtype !== ""
    || dueAt !== initialDueAt || priority !== "normal" || responsibleUserId !== selfId
    || recurrenceKind !== "none" || recurrenceInterval !== "1" || recurrenceUntil !== ""
    || links.length !== contextLinks.length || Boolean(client || property);
  useUnsavedChangesWarning(dirty && !pending);

  const hasClient = links.some((l) => l.kind === "client");
  const hasProperty = links.some((l) => l.kind === "property");

  function applyTemplate(t: Template) {
    setTitle(t.title);
    setTaskType(t.taskType);
    setSubtype(t.taskSubtypeCode ?? "");
    setRecurrenceKind(t.recurrenceKind);
    setRecurrenceInterval("1");
    setTemplateHint(t.hint);
  }

  async function submit() {
    const payloadLinks: Record<string, string[]> = {};
    for (const l of links) (payloadLinks[LINK_FIELD[l.kind]] ??= []).push(l.id);
    if (client) (payloadLinks.clientIds ??= []).push(client.id);
    if (property) (payloadLinks.propertyIds ??= []).push(property.id);
    const res = await run(() =>
      apiCall<{ id: string }>("POST", "/api/v1/tasks", {
        title,
        description: description || null,
        taskType,
        taskSubtypeCode: taskType === "postdeal" ? subtype || null : null,
        dueAt,
        priority,
        responsibleUserId: responsibleUserId || undefined,
        recurrenceKind: recurrenceKind === "quarterly" ? "monthly" : recurrenceKind === "weekdays" ? "none" : recurrenceKind,
        recurrenceRule: recurrenceKind === "weekdays" ? "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" : null,
        recurrenceInterval: recurrenceKind === "quarterly" ? 3 : recurrenceKind === "none" ? 1 : recurrenceInterval,
        recurrenceUntil: recurrenceKind === "none" ? null : recurrenceUntil || null,
        links: payloadLinks,
      }),
    );
    if (res) {
      router.push(returnHref ?? `/tasks/${res.id}`);
      router.refresh();
    }
  }

  const linkError = Object.entries(error?.fieldErrors ?? {})
    .filter(([k]) => k.startsWith("links"))
    .map(([, v]) => v.join("; "))
    .join("; ");

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <FormErrorBanner error={error} />

      <DisclosureSection title="Выбрать типовую задачу" hint="Шаблон заполнит название, тип и повторение. Проверьте срок перед сохранением.">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">Шаблоны:</span>
        {TEMPLATES.map((t) => (
          <button key={t.label} type="button" className="btn btn-sm" onClick={() => applyTemplate(t)}>
            {t.label}
          </button>
        ))}
      </div>
      </DisclosureSection>
      {templateHint ? <div className="alert alert-info">{templateHint}</div> : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Что сделать" required error={fieldError("title")} className="md:col-span-4">
          <input className={`input ${fieldError("title") ? "input-error" : ""}`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, перезвонить по поводу показа" />
        </Field>
        <Field label="Тип" required error={fieldError("taskType")}>
          <SelectInput value={taskType} onChange={setTaskType} options={optionsOf("taskType")} />
        </Field>
        {taskType === "postdeal" ? (
          <Field label="Подвид постсделочной задачи" required error={fieldError("taskSubtypeCode")}>
            <SelectInput value={subtype} onChange={setSubtype} options={optionsOf("postdealSubtype")} placeholder="Выберите…" invalid={Boolean(fieldError("taskSubtypeCode"))} />
          </Field>
        ) : null}
        <Field label="Срок" required error={fieldError("dueAt")}>
          <DateTimeInput value={dueAt} onChange={setDueAt} timeZone={timeZone} invalid={Boolean(fieldError("dueAt"))} />
        </Field>
        <Field label="Приоритет" error={fieldError("priority")}>
          <SelectInput value={priority} onChange={setPriority} options={optionsOf("taskPriority")} />
        </Field>
        <Field label="Ответственный" error={fieldError("responsibleUserId")} className="md:col-span-2" hint={isManager ? undefined : "Риелтор назначает задачу себе или руководителю"}>
          <SelectInput value={responsibleUserId} onChange={setResponsible} options={users} />
        </Field>
        <Field label="Описание" error={fieldError("description")} className="md:col-span-4">
          <textarea className="input min-h-20" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>

      <DisclosureSection title="Повторение задачи" hint={recurrenceKind === "none" ? "Сейчас задача разовая. Раскройте, чтобы настроить повторение." : "Настроено повторение — параметры сохраняются при сворачивании."} error={["recurrenceKind", "recurrenceInterval", "recurrenceUntil", "recurrenceRule"].map(fieldError).filter(Boolean).join("; ")}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field label="Повторять" error={fieldError("recurrenceKind")}>
            <SelectInput value={recurrenceKind} onChange={setRecurrenceKind} options={[...optionsOf("recurrenceKind"), { value: "weekdays", label: "По будням" }, { value: "quarterly", label: "Ежеквартально" }]} />
          </Field>
          {recurrenceKind !== "none" ? (
            <>
              {!["quarterly", "weekdays"].includes(recurrenceKind) ? <Field label={`Интервал, ${UNIT[recurrenceKind] ?? ""}`} error={fieldError("recurrenceInterval")} hint="1 — каждый период, 2 — через один и т.д.">
                <input className="input" type="number" min={1} max={365} value={recurrenceInterval} onChange={(e) => setRecurrenceInterval(e.target.value)} />
              </Field> : null}
              <Field label="Повторять до (включительно)" error={fieldError("recurrenceUntil")} hint="Пусто — без ограничения">
                <input className="input" type="date" value={recurrenceUntil} onChange={(e) => setRecurrenceUntil(e.target.value)} />
              </Field>
            </>
          ) : null}
        </div>
        {recurrenceKind !== "none" ? <p className="mt-2 text-xs text-slate-500">Следующий экземпляр создаётся автоматически при выполнении текущего.</p> : null}
      </DisclosureSection>

      <DisclosureSection title="Связать с клиентом или объектом" defaultOpen={contextLinks.length > 0} error={linkError} hint="Связи помогают перейти к нужной карточке из задачи.">
        {links.length ? (
          <ul className="mb-3 space-y-1">
            {links.map((l) => (
              <li key={`${l.kind}-${l.id}`} className="flex items-center gap-2 text-sm">
                <span className="text-xs text-slate-500">{l.kindLabel}:</span>
                <Link href={l.href} className="link" target="_blank">
                  {l.label}
                </Link>
                <button type="button" className="btn btn-sm btn-link" onClick={() => setLinks(links.filter((x) => x !== l))}>
                  Убрать
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {!hasClient ? (
            <Field label="Клиент">
              <EntityPicker<PickedClient>
                url="/api/v1/clients/pick"
                value={client}
                onChange={setClient}
                placeholder="Поиск клиента по имени или телефону…"
                render={(c) => (
                  <span>
                    {c.displayName}
                    {c.contacts[0] ? <span className="ml-1 text-xs text-slate-500">{c.contacts[0].rawValue}</span> : null}
                  </span>
                )}
              />
            </Field>
          ) : null}
          {!hasProperty ? (
            <Field label="Объект">
              <EntityPicker<PickedProperty> url="/api/v1/properties/pick" value={property} onChange={setProperty} placeholder="Поиск объекта по адресу…" render={(p) => p.addressText} />
            </Field>
          ) : null}
        </div>
        {!links.length && !client && !property ? <p className="mt-2 text-xs text-slate-500">Связь необязательна, но помогает открыть нужную карточку прямо из задачи.</p> : null}
        {linkError ? <p className="field-error">{linkError}</p> : null}
      </DisclosureSection>

      {recurrenceKind !== "none" ? <p className="text-sm text-slate-600" role="status">Повторение: {recurrenceKind === "quarterly" ? "ежеквартально" : recurrenceKind === "weekdays" ? "по будням" : optionsOf("recurrenceKind").find(o => o.value === recurrenceKind)?.label}. Настройки — в разделе «Повторение задачи».</p> : null}
      <div className="flex gap-2">
        <SubmitButton pending={pending}>Создать задачу</SubmitButton>
        <button type="button" className="btn" onClick={() => router.back()}>
          Отмена
        </button>
      </div>
    </form>
  );
}
