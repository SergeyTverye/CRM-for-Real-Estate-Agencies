"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { apiCall } from "@/ui/api-client";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { Field, FormErrorBanner, SubmitButton } from "@/ui/form";
import { DisclosureSection } from "@/ui/disclosure-section";
import { EntityPicker, DateTimeInput, NextActionFields, SelectInput, defaultNextAction, type NextActionValue, type Option } from "@/ui/client-kit";
import { DuplicateNotice, emptyClient, NewClientFields, newClientPayload, type NewClientValue } from "@/ui/domain/client-fields";
import { NeedParamsFields, emptyNeedParams, needParamsPayload, type NeedParamsOptions, type NeedParamsValue } from "@/ui/domain/need-params-fields";
import { ClientPicker, PropertyPicker, type ClientPick, type PropertyPick } from "@/ui/domain/need-pickers";
import { NEED_TASK_TYPES } from "@/ui/domain/need-state-actions";
import { labelOf, optionsOf } from "@/shared/codebook";



export interface ResponsiblePreview {
  responsible: { id: string; displayName: string };
  byPropertyRule: boolean;
}

interface RegisterResult {
  requestId: string;
  clientId: string | null;
  needId: string | null;
  taskId: string | null;
  responsibleUserId: string;
  assignedToOther: boolean;
  responsibleConflict: { propertyResponsible: string; clientResponsible: string } | null;
  escalated: boolean;
  duplicateWarnings: { clientId: string; displayName: string }[];
  clientReactivated: boolean;
}

type ClientMode = "new" | "existing" | "none";
type ResultCode = "new_need" | "linked_existing_need" | "one_off_service" | "no_followup" | "invalid_or_spam";

const RESULT_HINTS: Record<ResultCode, string> = {
  new_need: "Клиент ищет или продаёт объект — заводим запрос с параметрами и следующим действием.",
  linked_existing_need: "Звонок по уже открытому запросу клиента.",
  one_off_service: "Консультация или услуга без подбора; при необходимости — задача.",
  no_followup: "Продолжения нет, но факт обращения и источник сохраняются.",
  invalid_or_spam: "Ошибочный звонок, реклама, спам.",
};

const CLIENT_MODES: { value: ClientMode; label: string }[] = [
  { value: "new", label: "Новый клиент" },
  { value: "existing", label: "Найти в базе" },
  { value: "none", label: "Без клиента" },
];

interface NeedRow {
  id: string;
  operationType: string;
  propertyType: string;
  district: string | null;
  stage: string;
}

export interface RequestFormProps {
  callMode?: boolean;
  actorId: string;
  isManager: boolean;
  timeZone: string;
  channels: Option[];
  sources: Option[];
  users: Option[];
  needOptions: NeedParamsOptions;
  initialProperty: PropertyPick | null;
  initialPreview: ResponsiblePreview | null;
  initialClient: ClientPick | null;
  initialClientNeeds: Option[];
  advertisementId?: string;
}

interface Done extends RegisterResult {
  responsibleName: string;
  propertyResponsibleName: string | null;
}

export function RequestForm(props: RequestFormProps) {
  const [done, setDone] = useState<Done | null>(null);
  const [round, setRound] = useState(0);
  if (done) {
    return (
      <RequestResult
        result={done}
        canOpen={props.isManager || !done.assignedToOther}
        onAgain={() => {
          setDone(null);
          setRound((r) => r + 1);
        }}
      />
    );
  }
  return <RequestFormInner key={round} {...props} onDone={setDone} />;
}

function Segmented<T extends string>({ value, options, onChange, name }: { value: T; options: { value: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void; name: string }) {
  return (
    <div className="inline-flex flex-wrap overflow-hidden rounded-md border border-slate-300" role="radiogroup" aria-label={name}>
      {options.map((o, i) => (
        <label
          key={o.value}
          className={`cursor-pointer px-3 py-1.5 text-sm ${i ? "border-l border-slate-300" : ""} ${value === o.value ? "bg-brand-600 font-medium text-white" : "bg-white text-slate-700 hover:bg-slate-50"} ${o.disabled ? "cursor-not-allowed opacity-50" : ""}`}
        >
          <input type="radio" name={name} className="sr-only" checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="space-y-3 border-t border-slate-100 pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function RequestFormInner({
  actorId,
  isManager,
  timeZone,
  channels,
  sources,
  users,
  needOptions,
  initialProperty,
  initialPreview,
  initialClient,
  initialClientNeeds,
  advertisementId: initialAdvertisementId,
  callMode = false,
  onDone,
}: RequestFormProps & { onDone: (r: Done) => void }) {
  const [advertisement, setAdvertisement] = useState<{ id: string; label: string; propertyId?: string } | null>(() => initialAdvertisementId ? { id: initialAdvertisementId, label: "Объявление агентства" } : null);
  const advertisementId = advertisement?.id;
  const [external, setExternal] = useState<{ id: string; label: string } | null>(null);
  const [callOutcome, setCallOutcome] = useState("one_time");
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString());
  const [channelCode, setChannel] = useState(() => (channels.some((c) => c.value === "phone") ? "phone" : ""));
  const [sourceCode, setSource] = useState("");
  const [property, setProperty] = useState<PropertyPick | null>(initialProperty);
  const [preview, setPreview] = useState<ResponsiblePreview | null>(initialPreview);
  const [clientMode, setClientMode] = useState<ClientMode>(initialClient ? "existing" : callMode ? "none" : "new");
  const [client, setClient] = useState<ClientPick | null>(initialClient);
  const [clientNeeds, setClientNeeds] = useState<Option[]>(initialClientNeeds);
  const [newClient, setNewClient] = useState<NewClientValue>(emptyClient);
  const [rawContact, setRawContact] = useState("");
  const [summary, setSummary] = useState("");
  const [resultCode, setResultCode] = useState<ResultCode>(callMode ? "one_off_service" : "new_need");
  const [need, setNeed] = useState<NeedParamsValue>(emptyNeedParams);
  const [next, setNext] = useState<NextActionValue>(() => defaultNextAction("Связаться с клиентом"));
  const [linkedNeedId, setLinkedNeedId] = useState(initialClientNeeds.length === 1 ? (initialClientNeeds[0]?.value ?? "") : "");
  const [withNext, setWithNext] = useState(false);
  const [responsibleUserId, setResponsible] = useState("");
  const { pending, error, run, fieldError, setError } = useApiAction();
  const previewSeq = useRef(0);
  const needsSeq = useRef(0);

  const dirty = Boolean(summary || rawContact || sourceCode || property || advertisement || external || responsibleUserId || newClient.displayName || newClient.contacts.some((c) => c.value) || client);
  useUnsavedChangesWarning(dirty && !pending);

  
  const clientFieldError = (n: string) => fieldError(n) ?? (n.startsWith("client.client.") ? fieldError(n.slice("client.client.".length)) : undefined);

  async function changeProperty(p: PropertyPick | null) {
    setProperty(p);
    setPreview(null);
    const seq = ++previewSeq.current;
    if (!p && !advertisementId) return;
    const qs = new URLSearchParams();
    if (p) qs.set("propertyId", p.id);
    if (advertisementId) qs.set("advertisementId", advertisementId);
    const res = await apiCall<ResponsiblePreview>("GET", `/api/v1/requests/responsible-preview?${qs.toString()}`).catch(() => null);
    if (seq === previewSeq.current) setPreview(res);
  }

  async function changeClient(c: ClientPick | null) {
    setClient(c);
    setLinkedNeedId("");
    setClientNeeds([]);
    const seq = ++needsSeq.current;
    if (!c) return;
    const res = await apiCall<{ items: NeedRow[] }>("GET", `/api/v1/needs?clientId=${c.id}&status=open&pageSize=50`).catch(() => ({ items: [] as NeedRow[] }));
    if (seq !== needsSeq.current) return;
    const label = (opts: Option[], v: string) => opts.find((o) => o.value === v)?.label ?? v;
    const opts = res.items.map((n) => ({
      value: n.id,
      label: [label(needOptions.operationTypes, n.operationType), label(needOptions.propertyTypes, n.propertyType), n.district, labelOf("needStage", n.stage)].filter(Boolean).join(" · "),
    }));
    setClientNeeds(opts);
    if (opts.length === 1) setLinkedNeedId(opts[0]!.value);
  }

  function changeMode(m: ClientMode) {
    setClientMode(m);
    setError(null);
    if (m === "none" && (resultCode === "new_need" || resultCode === "linked_existing_need")) setResultCode("no_followup");
    if (m === "new" && resultCode === "linked_existing_need") setResultCode("new_need");
  }

  function pickDuplicate(id: string, displayName: string) {
    setClientMode("existing");
    setError(null);
    void changeClient({ id, displayName, contacts: [] });
  }

  const nameOf = (uid: string) =>
    uid === actorId ? "вы" : preview?.responsible.id === uid ? preview.responsible.displayName : (users.find((u) => u.value === uid)?.label ?? "другой сотрудник");

  async function submit(opts: { confirmDuplicate?: boolean; escalate?: boolean; restoreArchived?: boolean } = {}) {
    if (clientMode === "existing" && !client) {
      setError({ code: "VALIDATION_ERROR", message: "Проверьте заполнение формы", fieldErrors: { "client.clientId": ["Выберите клиента или переключитесь на «Новый клиент»"] } });
      return;
    }
    if (resultCode === "linked_existing_need" && !linkedNeedId) {
      setError({ code: "VALIDATION_ERROR", message: "Проверьте заполнение формы", fieldErrors: { "outcome.needId": ["Выберите потребность"] } });
      return;
    }
    const clientChoice =
      clientMode === "existing" ? { mode: "existing", clientId: client!.id } : clientMode === "new" ? { mode: "new", client: newClientPayload(newClient, opts.confirmDuplicate ?? false) } : { mode: "none" };
    const outcome =
      resultCode === "new_need"
        ? { resultCode, need: needParamsPayload(need), nextAction: next }
        : resultCode === "linked_existing_need"
          ? { resultCode, needId: linkedNeedId, nextAction: next }
          : resultCode === "one_off_service"
            ? { resultCode, nextAction: withNext ? next : undefined }
            : { resultCode };
    const body = {
      occurredAt,
      callAt: channelCode === "phone" ? occurredAt : undefined,
      outcomeCode: resultCode === "new_need" || resultCode === "linked_existing_need" ? "prospective" : resultCode === "invalid_or_spam" ? (callOutcome === "wrong" ? "wrong" : "spam") : "one_time",
      externalListingId: external?.id,
      channelCode,
      sourceCode,
      summary: summary || null,
      rawContact: clientMode === "none" ? rawContact || null : undefined,
      propertyId: property?.id,
      advertisementId,
      responsibleUserId: isManager && clientMode !== "existing" && responsibleUserId ? responsibleUserId : undefined,
      client: clientChoice,
      outcome,
      escalateDuplicate: opts.escalate ?? false,
      restoreArchivedClient: opts.restoreArchived ?? false,
    };
    const res = await run(() => apiCall<RegisterResult>("POST", "/api/v1/requests", body));
    if (res) {
      onDone({
        ...res,
        responsibleName: nameOf(res.responsibleUserId),
        propertyResponsibleName: res.responsibleConflict ? nameOf(res.responsibleConflict.propertyResponsible) : null,
      });
      window.scrollTo({ top: 0 });
    }
  }

  const dupError = error && (error.code === "PROBABLE_DUPLICATE" || error.code === "DUPLICATE_CONFLICT") ? error : null;
  const archivedError = error?.code === "CLIENT_ARCHIVED" ? error : null;

  const resultOptions = (["new_need", "linked_existing_need", "one_off_service", "no_followup", "invalid_or_spam"] as ResultCode[]).map((value) => ({
    value,
    label: `${["new_need", "linked_existing_need"].includes(value) ? "Перспективное — " : ""}${labelOf("leadResult", value)}`,
    disabled: (clientMode === "none" && (value === "new_need" || value === "linked_existing_need")) || (clientMode === "new" && value === "linked_existing_need"),
  }));

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {!dupError && !archivedError ? <FormErrorBanner error={error} /> : null}

      <Section title="Обращение">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Дата и время" required error={fieldError("occurredAt")}>
            <DateTimeInput value={occurredAt} onChange={setOccurredAt} timeZone={timeZone} invalid={Boolean(fieldError("occurredAt"))} />
          </Field>
          <Field label="Канал" required error={fieldError("channelCode")}>
            <SelectInput value={channelCode} onChange={setChannel} options={channels} placeholder="—" invalid={Boolean(fieldError("channelCode"))} />
          </Field>
          <Field label="Источник" required error={fieldError("sourceCode")} hint="Откуда клиент узнал: площадка, вывеска, рекомендация">
            <SelectInput value={sourceCode} onChange={setSource} options={sources} placeholder="—" invalid={Boolean(fieldError("sourceCode"))} />
          </Field>
        </div>
        <Field label="Объект, о котором обращение" error={fieldError("propertyId") ?? fieldError("advertisementId")} hint={property ? undefined : "Необязательно. Если звонят по объекту или объявлению — выберите его."}>
          <PropertyPicker value={property} onChange={(p) => void changeProperty(p)} />
        </Field>
        <DisclosureSection title="Объявление, по которому обратились" defaultOpen={Boolean(advertisementId || external)} error={[fieldError("advertisementId"), fieldError("externalListingId")].filter(Boolean).join("; ")}>
        <Field label="Объявление агентства" error={fieldError("advertisementId")}>
          <EntityPicker url="/api/v1/requests/pick-context?kind=advertisement" value={advertisement} onChange={async (ad) => {
            setAdvertisement(ad); setProperty(null); setPreview(null);
            if (ad) setPreview(await apiCall<ResponsiblePreview>("GET", `/api/v1/requests/responsible-preview?advertisementId=${ad.id}`).catch(() => null));
          }} render={(ad) => ad.label} placeholder="Площадка или адрес…" />
        </Field>
        <Field label="Внешнее объявление" error={fieldError("externalListingId")}>
          <EntityPicker url="/api/v1/requests/pick-context?kind=external" value={external} onChange={setExternal} render={(ad) => ad.label} placeholder="Источник или адрес внешнего объявления…" />
        </Field>
        </DisclosureSection>
        {advertisementId ? <div className="text-xs text-slate-500">Обращение по объявлению агентства (из ссылки).</div> : null}
        {preview ? (
          <div className="alert alert-info">
            {preview.byPropertyRule ? (
              <>
                Ответственный объекта: <span className="font-medium">{preview.responsible.id === actorId ? `${preview.responsible.displayName} (вы)` : preview.responsible.displayName}</span>.{" "}
                {clientMode === "existing"
                  ? "У существующего клиента ответственный не меняется автоматически; если он отличается от ответственного объекта — конфликт будет показан руководителю."
                  : "Новый клиент, обращение и потребность закрепятся за ним — правило «чей объект, того и клиент»."}
              </>
            ) : (
              <>У объекта нет ответственного — новый клиент будет закреплён за вами.</>
            )}
          </div>
        ) : null}
      </Section>

      <Section title="Клиент" aside={<Segmented name="Клиент" value={clientMode} options={CLIENT_MODES} onChange={changeMode} />}>
        {fieldError("client") ? <p className="field-error">{fieldError("client")}</p> : null}
        <DuplicateNotice
          error={dupError}
          onConfirm={() => void submit({ confirmDuplicate: true })}
          onPick={(c) => pickDuplicate(c.clientId, c.displayName)}
          onEscalate={() => void submit({ escalate: true })}
        />
        {clientMode === "existing" ? (
          <Field label="Клиент" required error={fieldError("client.clientId")}>
            <ClientPicker value={client} onChange={(c) => void changeClient(c)} invalid={Boolean(fieldError("client.clientId"))} />
          </Field>
        ) : null}
        {clientMode === "new" ? (
          <>
            <NewClientFields value={newClient} onChange={setNewClient} fieldError={clientFieldError} prefix="client.client." />
            <p className="text-xs text-slate-500">Достаточно имени и телефона — остальное можно дополнить в карточке клиента позже. При совпадении контакта система предупредит о дубле.</p>
          </>
        ) : null}
        {clientMode === "none" ? (
          <Field label="Контакт (как есть)" error={fieldError("rawContact")} hint="Номер или имя, если клиента заводить не нужно">
            <input className="input" value={rawContact} onChange={(e) => setRawContact(e.target.value)} />
          </Field>
        ) : null}
        {archivedError ? (
          <div className="alert alert-warning space-y-2" role="alert">
            <div>{archivedError.message}</div>
            {isManager ? (
              <button type="button" className="btn btn-sm" onClick={() => void submit({ restoreArchived: true })}>
                Восстановить клиента из архива и зарегистрировать
              </button>
            ) : (
              <div className="text-xs">Выберите результат без потребности (обращение сохранится в истории) или передайте вопрос руководителю.</div>
            )}
          </div>
        ) : null}
      </Section>

      <Section title="Итог разговора">
        {resultCode === "invalid_or_spam" ? <Field label="Результат звонка"><SelectInput value={callOutcome === "wrong" ? "wrong" : "spam"} onChange={setCallOutcome} options={optionsOf("callOutcome").filter(o => o.value === "spam" || o.value === "wrong")} /></Field> : null}
        <Field label="Кратко: что хотел клиент, о чём договорились" required={["no_followup", "invalid_or_spam", "one_off_service"].includes(resultCode)} hint={["no_followup", "invalid_or_spam", "one_off_service"].includes(resultCode) ? "Укажите причину завершения обращения" : undefined} error={fieldError("summary")}>
          <textarea className="input min-h-20" value={summary} onChange={(e) => setSummary(e.target.value)} />
        </Field>
        <div className="space-y-1.5">
          <Segmented name="Результат" value={resultCode} options={resultOptions} onChange={setResultCode} />
          <p className="text-xs text-slate-500">{RESULT_HINTS[resultCode]}</p>
        </div>

        {resultCode === "new_need" ? (
          <div className="space-y-4 rounded-md border border-slate-200 p-3">
            <NeedParamsFields value={need} onChange={setNeed} options={needOptions} fieldError={fieldError} prefix="outcome.need." compact />
            <NextActionFields value={next} onChange={setNext} timeZone={timeZone} taskTypes={NEED_TASK_TYPES} users={isManager ? users : undefined} errors={fieldError} prefix="outcome.nextAction" />
          </div>
        ) : null}

        {resultCode === "linked_existing_need" ? (
          <div className="space-y-3 rounded-md border border-slate-200 p-3">
            <Field label="Потребность клиента" required error={fieldError("outcome.needId")}>
              {clientNeeds.length ? (
                <SelectInput value={linkedNeedId} onChange={setLinkedNeedId} options={clientNeeds} placeholder="—" invalid={Boolean(fieldError("outcome.needId"))} />
              ) : (
                <div className="text-sm text-slate-500">{client ? "У клиента нет открытых потребностей — выберите «Перспективное — новая потребность»." : "Сначала выберите клиента."}</div>
              )}
            </Field>
            <NextActionFields value={next} onChange={setNext} timeZone={timeZone} taskTypes={NEED_TASK_TYPES} users={isManager ? users : undefined} errors={fieldError} prefix="outcome.nextAction" />
          </div>
        ) : null}

        {resultCode === "one_off_service" ? (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={withNext} onChange={(e) => setWithNext(e.target.checked)} /> Создать задачу
            </label>
            {withNext ? <NextActionFields value={next} onChange={setNext} timeZone={timeZone} taskTypes={NEED_TASK_TYPES} users={isManager ? users : undefined} errors={fieldError} prefix="outcome.nextAction" heading="Задача" /> : null}
          </div>
        ) : null}
      </Section>

      {isManager && clientMode !== "existing" ? (
        <DisclosureSection title="Назначить другого ответственного" error={fieldError("responsibleUserId")}>
          <Field label="Назначить ответственного вручную" hint="По умолчанию — ответственный объекта, без объекта — вы. Изменение журналируется." error={fieldError("responsibleUserId")}>
            <SelectInput value={responsibleUserId} onChange={setResponsible} options={users} placeholder="По правилу предприятия" />
          </Field>
        </DisclosureSection>
      ) : null}

      <div className="flex gap-2 border-t border-slate-100 pt-4">
        <SubmitButton pending={pending}>Зарегистрировать обращение</SubmitButton>
      </div>
    </form>
  );
}

function RequestResult({ result: r, canOpen, onAgain }: { result: Done; canOpen: boolean; onAgain: () => void }) {
  return (
    <div className="space-y-3">
      <div className="alert alert-success">
        <div className="font-medium">Обращение зарегистрировано.</div>
        {!r.escalated ? (
          <div className="mt-0.5">
            Ответственный: <span className="font-medium">{r.responsibleName}</span>
            {r.needId ? " · создана потребность со следующим действием" : r.taskId ? " · создана задача" : ""}
          </div>
        ) : null}
      </div>
      {r.escalated ? (
        <div className="alert alert-warning">
          Контакт уже зарегистрирован за другим сотрудником. Обращение сохранено без привязки к клиенту и передано руководителю — ему поставлена задача решить, за кем закрепить клиента.
        </div>
      ) : null}
      {r.assignedToOther && !r.escalated ? (
        <div className="alert alert-info">
          Клиент закреплён за ответственным объекта ({r.responsibleName}) по правилу «чей объект, того и клиент».
          {canOpen ? null : " Карточка клиента и потребности доступна ему и руководителю; обращение остаётся в вашем списке."}
        </div>
      ) : null}
      {r.responsibleConflict ? (
        <div className="alert alert-warning">
          Клиент закреплён не за ответственным объекта{r.propertyResponsibleName ? ` (${r.propertyResponsibleName})` : ""}. Ответственный клиента не изменён автоматически — при необходимости передачу выполняет руководитель.
        </div>
      ) : null}
      {r.duplicateWarnings.length ? (
        <div className="alert alert-warning">
          Новый клиент создан, хотя контакт совпал с: {r.duplicateWarnings.map((d) => d.displayName).join(", ")}. Если это один человек — сообщите руководителю.
        </div>
      ) : null}
      {r.clientReactivated ? <div className="alert alert-info">Клиент снова переведён в активные.</div> : null}
      <div className="flex flex-wrap gap-2 pt-1">
        {canOpen && r.needId ? (
          <>
            <Link className="btn btn-primary" href={`/needs/${r.needId}`}>
              Открыть потребность
            </Link>
            <Link className="btn" href={`/needs/${r.needId}/matching`}>
              Подобрать объекты
            </Link>
          </>
        ) : null}
        {canOpen && r.clientId ? (
          <Link className="btn" href={`/clients/${r.clientId}`}>
            Карточка клиента
          </Link>
        ) : null}
        <Link className="btn" href={`/requests/${r.requestId}`}>
          Обращение
        </Link>
        <button type="button" className="btn" onClick={onAgain}>
          Зарегистрировать ещё
        </button>
        <Link className="btn btn-link" href="/requests">
          К списку обращений
        </Link>
      </div>
    </div>
  );
}
