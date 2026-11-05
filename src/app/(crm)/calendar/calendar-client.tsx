"use client";
import { DateTimeInput, Modal, EntityPicker } from "@/ui/client-kit";
import { useSearchParams } from "next/navigation";
import { requestConfirmation } from "@/ui/confirm-dialog";
import { recurrenceForm, recurrenceRule } from "@/modules/calendar/domain/recurrence-form";
import { WEEK_DAYS } from "@/modules/calendar/domain/calendar-rules";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EventSourceFunc } from "@fullcalendar/core";
import FullCalendar from "@fullcalendar/react";
import { CalendarQuickCreate } from "./quick-create";
import type { NeedLabels } from "@/ui/domain/deal-pickers";
import dayGrid from "@fullcalendar/daygrid";
import timeGrid from "@fullcalendar/timegrid";
import list from "@fullcalendar/list";
import interaction from "@fullcalendar/interaction";
import ru from "@fullcalendar/core/locales/ru";
import type { CalendarItem } from "@/modules/calendar/domain/calendar-rules";
import { apiCall } from "@/ui/api-client";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { Field, FormErrorBanner } from "@/ui/form";
import { fromDateTimeLocalValue, toDateTimeLocalValue } from "@/shared/time";
import { optionsOf } from "@/shared/codebook";

type LinkPick = { id: string; label: string };
type EventRecord = { linked?: Partial<Record<"clientId" | "needId" | "propertyId" | "dealId", LinkPick | null>>; id?: string; title: string; description: string | null; startAt: string; endAt: string; allDay: boolean; visibility: string; recurrenceRule: string | null; updatedAt?: string; clientId?: string | null; needId?: string | null; propertyId?: string | null; dealId?: string | null };
export function CalendarClient({ timeZone, userId, users, labels }: { timeZone: string; userId: string; users: { value: string; label: string }[]; labels: NeedLabels }) {
  const eventId = useSearchParams().get("eventId");
  const calendar = useRef<FullCalendar>(null);
  const [employee, setEmployee] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [editing, setEditing] = useState<EventRecord | null>(null);
  const [dirty, setDirty] = useState(false);
  const action = useApiAction();
  const setError = action.setError;
  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    void apiCall<EventRecord & { editable: boolean }>("GET", `/api/v1/calendar/events/${encodeURIComponent(eventId)}`).then(event => {
      if (cancelled) return;
      calendar.current?.getApi().gotoDate(toDateTimeLocalValue(event.startAt, timeZone));
      if (event.editable) { setEditing(event); setDirty(false); }
      else setNotice("Подробности встречи недоступны. В календаре показана только занятость.");
    }).catch(error => { if (!cancelled) setError({ code: "LOAD_ERROR", message: error.message }); });
    return () => { cancelled = true; };
  }, [eventId, timeZone, setError]);
  useUnsavedChangesWarning(dirty);
  const refresh = () => calendar.current?.getApi().refetchEvents();
  const local = (iso: string) => iso.length === 10 ? iso : toDateTimeLocalValue(iso, timeZone);
  // Without a premium timezone plugin, UTC is a display coordinate. Convert at both boundaries.
  const utc = (date: Date) => fromDateTimeLocalValue(date.toISOString().slice(0,16), timeZone);
  const loadEvents = useCallback<EventSourceFunc>((range, success, failure) => {
    const toUtc = (date: Date) => fromDateTimeLocalValue(date.toISOString().slice(0,16), timeZone);
    const displayTime = (iso: string) => iso.length === 10 ? iso : toDateTimeLocalValue(iso, timeZone);
    const q = new URLSearchParams({ from: toUtc(range.start), to: toUtc(range.end), ...(employee ? { employee } : {}), ...(type ? { type } : {}), ...(status ? { status } : {}) });
    apiCall<{ items: CalendarItem[] }>("GET", `/api/v1/calendar?${q}`).then(({ items }) => {
      setEmpty(!items.length);
      success(items.map(e => ({ id: e.id, title: e.title, start: displayTime(e.start), ...(e.end ? { end: displayTime(e.end) } : {}), allDay: e.allDay,
        editable: e.editable && !e.recurrenceRule, extendedProps: { item: e }, color: e.type === "calendar_event" ? "#475569" : e.type === "showing" ? "#047857" : "#2563eb" })));
    }).catch(e => { failure(e); setError({ code: "LOAD_ERROR", message: e.message }); });
  }, [timeZone, employee, type, status, setError]);
  const openNew = (start = new Date().toISOString()) => {
    setEditing({ title: "", description: "", startAt: start, endAt: new Date(+new Date(start) + 3600000).toISOString(), allDay: false, visibility: "private", recurrenceRule: null });
    setDirty(false);
  };
  async function close() { if (!dirty || await requestConfirmation("Закрыть без сохранения? Введённые изменения будут потеряны.")) { setEditing(null); setDirty(false); } }
  return <div>
    <h1 className="text-2xl font-semibold">Календарь</h1><p className="mb-3 text-sm">Часовой пояс: {timeZone}. Срок задачи и показ без длительности — точечные события.</p>
    <div className="mb-4 flex flex-wrap gap-2">
      <button className="btn btn-primary" onClick={() => openNew()}>+ Встреча / личная запись</button>
      <CalendarQuickCreate timeZone={timeZone} users={users} labels={labels} onDone={refresh} />
      <label>Сотрудник <select className="input" value={employee} onChange={e => setEmployee(e.target.value)}><option value="">Все доступные</option><option value={userId}>Я</option>{users.filter(u => u.value !== userId).map(u => <option key={u.value} value={u.value}>{u.label}</option>)}</select></label>
      <label>Тип <select className="input" value={type} onChange={e => setType(e.target.value)}><option value="">Все</option>{[["task","Задача"],["showing","Показ"],["agreement","Договор"],["calendar_event","Встреча / запись"]].map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label>Статус <select className="input" value={status} onChange={e => setStatus(e.target.value)}><option value="">Все</option>{[...optionsOf("taskStatus"), { value: "scheduled", label: "Встреча" }, { value: "busy", label: "Занято" }, { value: "active", label: "Действующий договор" }].map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
      <button className="btn" onClick={refresh}>Обновить</button>
    </div>
    <FormErrorBanner error={action.error} onRetry={() => { close(); refresh(); }} />
    {notice ? <p className="alert alert-warning mb-3" role="status">{notice}</p> : null}
    {loading ? <p role="status">Загрузка календаря…</p> : empty ? <p>В выбранном периоде событий нет. Выберите свободное время для создания встречи.</p> : null}
    <FullCalendar ref={calendar} plugins={[dayGrid, timeGrid, list, interaction]} locale={ru} timeZone="UTC" initialView="timeGridWeek"
      headerToolbar={{ left: "prev,next today", center: "title", right: "timeGridDay,timeGridWeek,dayGridMonth,listWeek" }}
      height="auto" firstDay={1} now={local(new Date().toISOString())} selectable eventDurationEditable={false} forceEventDuration={false} displayEventEnd={false}
      slotMinTime="07:00:00" slotMaxTime="22:00:00" scrollTime="08:00:00"
      eventMaxStack={3} dayMaxEvents={3} moreLinkText={n => `+ещё ${n}`} moreLinkContent={({ num }) => `+ещё ${num}`}
      eventDidMount={({ el, event }) => { el.title = event.title; }}
      loading={setLoading}
      events={loadEvents}
      select={r => { openNew(utc(r.start)); calendar.current?.getApi().unselect(); }}
      eventClick={e => {
        const item = e.event.extendedProps.item as CalendarItem;
        if (item.type === "calendar_event" && item.editable && item.sourceId) {
          void action.run(async () => { setEditing(await apiCall<EventRecord>("GET", `/api/v1/calendar/events/${item.sourceId}`)); setDirty(false); return true; });
        } else if (item.url) window.location.assign(item.url);
      }}
      eventDrop={e => {
        const item = e.event.extendedProps.item as CalendarItem;
        void action.run(async () => {
          try {
            const result = await apiCall<{ warning?: string }>("POST", "/api/v1/calendar/move", { type: item.type, id: item.sourceId, startAt: utc(e.event.start!), expectedUpdatedAt: item.updatedAt });
            setNotice(result.warning ?? null);
            refresh(); return true;
          } catch (error) { e.revert(); throw error; }
        });
      }} />
    {editing ? <EventEditor key={editing.id ?? editing.startAt} initial={editing} timeZone={timeZone} onDirty={() => setDirty(true)} onClose={close} onSaved={warning => { setNotice(warning ?? null); setDirty(false); setEditing(null); refresh(); }} /> : null}
  </div>;
}

function EventEditor({ initial, timeZone, onDirty, onClose, onSaved }: { initial: EventRecord; timeZone: string; onDirty: () => void; onClose: () => void; onSaved: (warning?: string) => void }) {
  const [value, setValue] = useState(initial);
  const action = useApiAction();
  const [repeat, setRepeat] = useState(() => { const form = recurrenceForm(initial.recurrenceRule, timeZone); if (!form.days.length) form.days = [WEEK_DAYS[(new Date(`${toDateTimeLocalValue(initial.startAt, timeZone)}:00Z`).getUTCDay()+6)%7]!]; return form; });
  const [repeatError, setRepeatError] = useState("");
  const change = (patch: Partial<EventRecord>) => { setValue(v => ({ ...v, ...patch })); onDirty(); };
  return <Modal open onClose={onClose} title={initial.id ? "Изменить серию / встречу" : "Новая встреча / личная запись"}>
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); void action.run(async () => {
      let rule: string | null;
      try { rule = recurrenceRule(repeat, value.startAt, timeZone); setRepeatError(""); } catch (error) { setRepeatError((error as Error).message); return undefined; }
      const result = await apiCall<{ warning?: string }>(initial.id ? "PATCH" : "POST", initial.id ? `/api/v1/calendar/events/${initial.id}` : "/api/v1/calendar/events", { ...value, recurrenceRule: rule, expectedUpdatedAt: initial.updatedAt });
      onSaved(result.warning); return true;
    }); }}>
      <FormErrorBanner error={action.error} onRetry={onClose} />
      <Field label="Заголовок" required error={action.fieldError("title")}><input className="input" required maxLength={300} value={value.title} onChange={e => change({ title: e.target.value })} /></Field>
      <Field label="Описание"><textarea className="input" maxLength={4000} value={value.description ?? ""} onChange={e => change({ description: e.target.value })} /></Field>
      {(["startAt", "endAt"] as const).map(key => <Field key={key} label={key === "startAt" ? "Начало" : "Окончание"} error={action.fieldError(key)} required><DateTimeInput value={value[key]} timeZone={timeZone} onChange={iso => change({ [key]: iso })} /></Field>)}
      <label className="block"><input type="checkbox" checked={value.allDay} onChange={e => change({ allDay: e.target.checked })} /> Весь день (окончание исключается)</label>
      <Field label="Видимость"><select className="input" value={value.visibility} onChange={e => change({ visibility: e.target.value })}><option value="private">Личное — другим только «Занято»</option><option value="public">Общее</option></select></Field>
      <Field label="Повторение" error={repeatError || action.fieldError("recurrenceRule")}><select aria-label="Повторение" className="input" value={repeat.mode} onChange={e => { setRepeat({ ...repeat, mode: e.target.value as typeof repeat.mode }); onDirty(); }}>
        <option value="none">Не повторять</option><option value="daily">Ежедневно</option><option value="weekdays">По будням (пн–пт)</option><option value="weekly">Еженедельно по выбранным дням</option><option value="monthly">Ежемесячно</option>
      </select></Field>
      {repeat.mode === "weekly" ? <fieldset className="flex flex-wrap gap-3"><legend className="text-sm font-medium">Дни недели</legend>{WEEK_DAYS.map((day, i) => <label key={day}><input type="checkbox" checked={repeat.days.includes(day)} onChange={e => { setRepeat({ ...repeat, days: WEEK_DAYS.filter(d => d === day ? e.target.checked : repeat.days.includes(d)) }); onDirty(); }} /> {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][i]}</label>)}</fieldset> : null}
      {repeat.mode !== "none" ? <div className="space-y-3">
        <Field label="Окончание серии"><select aria-label="Окончание серии" className="input" value={repeat.end} onChange={e => { setRepeat({ ...repeat, end: e.target.value as typeof repeat.end }); onDirty(); }}><option value="never">Без даты окончания</option><option value="date">До даты включительно</option><option value="count">После N встреч</option></select></Field>
        {repeat.end === "date" ? <Field label="Последний день" required><input className="input" type="date" required value={repeat.until} onChange={e => { setRepeat({ ...repeat, until: e.target.value }); onDirty(); }} /></Field> : null}
        {repeat.end === "count" ? <Field label="Количество встреч в серии" hint="Включая первую встречу" required><input className="input" type="number" required min={1} max={1000} value={repeat.count} onChange={e => { setRepeat({ ...repeat, count: Number(e.target.value) }); onDirty(); }} /></Field> : null}
        {repeat.mode === "monthly" ? <p className="text-xs text-slate-500">В день месяца первой встречи. Месяцы без такого дня пропускаются.</p> : null}
      </div> : null}
      <details><summary>Связанные записи CRM</summary><div className="mt-3 space-y-3">{(["clientId", "needId", "propertyId", "dealId"] as const).map((key, index) => <Field key={key} label={["Клиент", "Потребность", "Объект", "Сделка"][index]!} error={action.fieldError(key)}><EntityPicker<LinkPick> url={`/api/v1/calendar/links?type=${key}`} value={value.linked?.[key] ?? null} onChange={pick => change({ [key]: pick?.id ?? null, linked: { ...value.linked, [key]: pick } })} render={pick => pick.label} placeholder="Поиск по имени или адресу…" /></Field>)}</div></details>
      <div className="flex gap-2"><button className="btn btn-primary" disabled={action.pending}>{action.pending ? "Сохранение…" : "Сохранить"}</button><button type="button" className="btn" onClick={onClose}>Закрыть</button>{initial.id ? <button type="button" className="btn" disabled={action.pending} onClick={async () => { if (await requestConfirmation("Удалить встречу / всю серию?")) void action.run(async () => { await apiCall("DELETE", `/api/v1/calendar/events/${initial.id}`, { expectedUpdatedAt: initial.updatedAt }); onSaved(); return true; }); }}>Удалить</button> : null}</div>
    </form>
  </Modal>;
}
