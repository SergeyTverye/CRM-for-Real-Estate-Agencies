"use client";
import { DateTimeInput, Modal, EntityPicker } from "@/ui/client-kit";
import { useSearchParams } from "next/navigation";
import { requestConfirmation } from "@/ui/confirm-dialog";
import { recurrenceForm, recurrenceRule } from "@/modules/calendar/domain/recurrence-form";
import { WEEK_DAYS } from "@/modules/calendar/domain/calendar-rules";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { DateSelectArg, EventClickArg, EventDropArg, EventSourceFunc } from "@fullcalendar/core";
import type FullCalendar from "@fullcalendar/react";
import { CalendarQuickCreate } from "./quick-create";
import type { NeedLabels } from "@/ui/domain/deal-pickers";
const CalendarView = dynamic(() => import("./calendar-view").then((m) => m.CalendarView), {
  ssr: false,
  loading: () => <p role="status">Загрузка календаря…</p>,
});
import type { CalendarItem } from "@/modules/calendar/domain/calendar-rules";
import { apiCall } from "@/ui/api-client";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { Field, FormErrorBanner } from "@/ui/form";
import { fromDateTimeLocalValue, toDateTimeLocalValue } from "@/shared/time";
import { optionsOf } from "@/shared/codebook";
import { PLANNER_COLORS, mergeDayAggregates, type DayAggregate } from "@/modules/calendar/domain/planner-rules";
import { MiniCalendar } from "./mini-calendar";
import { PlannerSettings } from "./planner-settings";
import { BrowserNotificationControls } from "@/modules/notifications/presentation/browser-notifications";

type LinkPick = { id: string; label: string };
type EventRecord = { linked?: Partial<Record<"clientId" | "needId" | "propertyId" | "dealId", LinkPick | null>>; id?: string; title: string; description: string | null; startAt: string; endAt: string; allDay: boolean; visibility: string; recurrenceRule: string | null; updatedAt?: string; clientId?: string | null; needId?: string | null; propertyId?: string | null; dealId?: string | null };
export function CalendarClient({ timeZone, userId, users, labels, isManager, setting }: { timeZone: string; userId: string; users: { value: string; label: string }[]; labels: NeedLabels; isManager: boolean; setting: { soonThresholdHours: number; updatedAt: string | null } }) {
  const eventId = useSearchParams().get("eventId");
  const calendar = useRef<FullCalendar>(null);
  const [scope, setScope] = useState("mine");
  const [employee, setEmployee] = useState(userId);
  const [client, setClient] = useState<LinkPick | null>(null);
  const [priority, setPriority] = useState("");
  const [deadline, setDeadline] = useState("");
  const [counts, setCounts] = useState<DayAggregate[]>([]);
  const [soonHours, setSoonHours] = useState(setting.soonThresholdHours);
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
  const utc = (date: Date) => fromDateTimeLocalValue(date.toISOString().slice(0,16), timeZone);
  const loadEvents = useCallback<EventSourceFunc>((range, success, failure) => {
    const toUtc = (date: Date) => fromDateTimeLocalValue(date.toISOString().slice(0,16), timeZone);
    const displayTime = (iso: string) => iso.length === 10 ? iso : toDateTimeLocalValue(iso, timeZone);
    const q = new URLSearchParams({ from: toUtc(range.start), to: toUtc(range.end), ...(employee ? { employee } : {}), ...(type ? { type } : {}), ...(status ? { status } : {}), ...(client ? { clientId: client.id } : {}), ...(priority ? { priority } : {}), ...(deadline ? { deadline } : {}) });
    if (+range.end - +range.start > 62 * 86400000) {
      apiCall<{ days: DayAggregate[]; soonThresholdHours: number }>("GET", `/api/v1/calendar/aggregate?${q}`).then(({ days, soonThresholdHours }) => {
        setCounts(days); setSoonHours(soonThresholdHours); setEmpty(!days.length);
        success(days.flatMap(day => (["red", "yellow", "green", "gray"] as const).filter(t => day[t] > 0).map(tone => ({ id: `aggregate:${day.day}:${tone}`, title: `${({ red: "Просрочено / критично", yellow: "Скоро", green: "Под контролем", gray: "Завершено / отменено" })[tone]}: ${day[tone]}`, start: day.day, allDay: true, editable: false, color: PLANNER_COLORS[tone], extendedProps: { aggregateDay: day.day } }))));
      }).catch(e => { failure(e); setError({ code: "LOAD_ERROR", message: e.message }); });
      return;
    }
    apiCall<{ items: CalendarItem[] }>("GET", `/api/v1/calendar?${q}`).then(({ items }) => {
      setCounts(mergeDayAggregates(items.map(item => { const day: DayAggregate = { day: displayTime(item.start).slice(0,10), total: 1, red: 0, yellow: 0, green: 0, gray: 0 }; day[item.tone ?? "green"] = 1; return day; })));
      setEmpty(!items.length);
      success(items.map(e => ({ id: e.id, title: `${e.title}${e.priority && e.priority !== "normal" ? ` · приоритет: ${optionsOf("taskPriority").find(p => p.value === e.priority)?.label ?? ""}` : ""}`, start: displayTime(e.start), ...(e.end ? { end: displayTime(e.end) } : {}), allDay: e.allDay,
        editable: e.editable && !e.recurrenceRule, extendedProps: { item: e }, color: PLANNER_COLORS[e.tone ?? "green"] })));
    }).catch(e => { failure(e); setError({ code: "LOAD_ERROR", message: e.message }); });
  }, [timeZone, employee, type, status, client, priority, deadline, setError]);
  const openNew = (start = new Date().toISOString()) => {
    setEditing({ title: "", description: "", startAt: start, endAt: new Date(+new Date(start) + 3600000).toISOString(), allDay: false, visibility: "private", recurrenceRule: null });
    setDirty(false);
  };
  async function close() { if (!dirty || await requestConfirmation("Закрыть без сохранения? Введённые изменения будут потеряны.")) { setEditing(null); setDirty(false); } }
  return <div className="planner-calendar">
    <style jsx global>{`.planner-calendar .fc-dayGridQuarter-view .fc-daygrid-day-frame { min-height: 72px; } .planner-calendar .fc-dayGridQuarter-view .fc-scrollgrid-sync-table { height: auto !important; } .planner-calendar .fc-toolbar { flex-wrap: wrap; gap: 12px; } @media (max-width: 640px) { .planner-calendar .fc-toolbar { flex-direction: column; align-items: stretch; } .planner-calendar .fc-toolbar-title { font-size: 1.1rem; text-align: center; } .planner-calendar .fc-button { padding: .45em .5em; font-size: .85rem; } }`}</style>
    <h1 className="text-2xl font-semibold">Планер</h1><p className="mb-3 text-sm">Часовой пояс: {timeZone}. Срок задачи и показ без длительности — точечные события.</p>
    <div className="mb-3 flex flex-wrap gap-3"><MiniCalendar initial={local(new Date().toISOString())} onSelect={day => { calendar.current?.getApi().gotoDate(day); }} /><BrowserNotificationControls /></div>
    {isManager ? <PlannerSettings initial={setting} onSaved={() => { void apiCall<{ soonThresholdHours: number }>("GET", "/api/v1/calendar/settings").then(s => setSoonHours(s.soonThresholdHours)); refresh(); }} /> : null}
    <p className="mb-3 text-sm" aria-label="Легенда цветов"><span className="text-red-700">Красный — просрочено / критично</span> · <span className="text-yellow-800">Жёлтый — до срока ≤ {soonHours} ч</span> · <span className="text-green-700">Зелёный — под контролем</span> · <span className="text-slate-500">Серый — завершено / отменено</span>. Деловой приоритет указан отдельно.</p>
    <details className="mb-4 rounded-md border border-slate-200 bg-white p-3"><summary className="cursor-pointer text-sm font-medium">Фильтры и быстрые действия</summary><div className="mt-3 flex flex-wrap items-end gap-2">
      <button className="btn btn-primary" onClick={() => openNew()}>+ Встреча / личная запись</button>
      <CalendarQuickCreate timeZone={timeZone} users={users} labels={labels} onDone={refresh} />
      <label>Охват <select className="input" value={scope} onChange={e => { setScope(e.target.value); setEmployee(e.target.value === "all" ? "" : userId); }}><option value="mine">Мои</option><option value="all">Все доступные</option><option value="employee">Сотрудник</option></select></label>
      {scope === "employee" ? <label>Сотрудник <select aria-label="Сотрудник планера" className="input" value={employee} onChange={e => setEmployee(e.target.value)}>{users.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}</select></label> : null}
      <div className="w-64"><label className="text-sm">Клиент</label><EntityPicker<LinkPick> url="/api/v1/calendar/links?type=clientId" value={client} onChange={setClient} render={c => c.label} placeholder="Поиск по названию клиента…" /></div>
      <label>Приоритет <select className="input" value={priority} onChange={e => setPriority(e.target.value)}><option value="">Все</option>{optionsOf("taskPriority").map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
      <label>Срок <select className="input" value={deadline} onChange={e => setDeadline(e.target.value)}><option value="">Все сроки</option><option value="overdue">Просрочено / критично</option><option value="soon">Скоро</option><option value="controlled">Под контролем</option><option value="closed">Завершено / отменено</option></select></label>
      <label>Тип <select className="input" value={type} onChange={e => setType(e.target.value)}><option value="">Все</option>{[["task","Задача"],["showing","Показ"],["agreement","Договор"],["calendar_event","Встреча / запись"]].map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label>Статус <select className="input" value={status} onChange={e => setStatus(e.target.value)}><option value="">Все</option>{[...optionsOf("taskStatus"), { value: "scheduled", label: "Встреча" }, { value: "busy", label: "Занято" }, { value: "signed", label: "Подписанный договор" }, { value: "draft", label: "Черновик договора" }, { value: "expired", label: "Истёкший договор" }].map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
      <button className="btn" onClick={refresh}>Обновить</button>
    </div>
    </details>
    <FormErrorBanner error={action.error} onRetry={() => { close(); refresh(); }} />
    {notice ? <p className="alert alert-warning mb-3" role="status">{notice}</p> : null}
    {loading ? <p role="status">Загрузка календаря…</p> : empty ? <p>В выбранном периоде событий нет. Выберите свободное время для создания встречи.</p> : null}
    <p className="mb-2 text-sm" role="status">Событий в периоде: {counts.reduce((s,d) => s+d.total,0)}.</p>
    <details className="mb-2 text-sm"><summary>Нагрузка по дням</summary><p className="mt-2 text-slate-600">{counts.map(d => `${d.day.slice(8)}.${d.day.slice(5,7)} — ${d.total}`).join("; ") || "Нет событий"}</p></details>
    <details className="mb-3 text-sm"><summary>Нагрузка по неделям</summary>{Object.entries(counts.reduce<Record<string,number>>((result, day) => { const date = new Date(`${day.day}T00:00:00Z`); date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7); const key = date.toISOString().slice(0,10); result[key] = (result[key] ?? 0)+day.total; return result; }, {})).map(([week,total]) => <p key={week}>Неделя с {week.split("-").reverse().join(".")}: {total}</p>)}</details>
    <CalendarView
      calendarRef={calendar}
      events={loadEvents}
      loading={setLoading}
      localNow={local(new Date().toISOString())}
      onSelectRange={(r: DateSelectArg) => { if (r.view.type === "dayGridQuarter") calendar.current?.getApi().changeView("timeGridDay", r.start); else openNew(utc(r.start)); calendar.current?.getApi().unselect(); }}
      onEventClick={(e: EventClickArg) => {
        if (e.event.extendedProps.aggregateDay) { calendar.current?.getApi().changeView("timeGridDay", e.event.extendedProps.aggregateDay); return; }
        const item = e.event.extendedProps.item as CalendarItem;
        if (item.type === "calendar_event" && item.editable && item.sourceId) {
          void action.run(async () => { setEditing(await apiCall<EventRecord>("GET", `/api/v1/calendar/events/${item.sourceId}`)); setDirty(false); return true; });
        } else if (item.url) window.location.assign(item.url);
      }}
      onEventDrop={(e: EventDropArg) => {
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
        <option value="none">Не повторять</option><option value="daily">Ежедневно</option><option value="weekdays">По будням (пн–пт)</option><option value="weekly">Еженедельно по выбранным дням</option><option value="monthly">Ежемесячно</option><option value="quarterly">Ежеквартально</option><option value="yearly">Ежегодно</option>
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
