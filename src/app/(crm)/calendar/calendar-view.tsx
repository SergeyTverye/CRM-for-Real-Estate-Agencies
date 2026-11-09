"use client";
import type { DateSelectArg, EventClickArg, EventDropArg, EventSourceFunc } from "@fullcalendar/core";
import ru from "@fullcalendar/core/locales/ru";
import dayGrid from "@fullcalendar/daygrid";
import interaction from "@fullcalendar/interaction";
import list from "@fullcalendar/list";
import FullCalendar from "@fullcalendar/react";
import timeGrid from "@fullcalendar/timegrid";
import type { RefObject } from "react";


export function CalendarView({
  calendarRef,
  events,
  loading,
  localNow,
  onSelectRange,
  onEventClick,
  onEventDrop,
}: {
  calendarRef: RefObject<FullCalendar | null>;
  events: EventSourceFunc;
  loading: (busy: boolean) => void;
  localNow: string;
  onSelectRange: (arg: DateSelectArg) => void;
  onEventClick: (arg: EventClickArg) => void;
  onEventDrop: (arg: EventDropArg) => void;
}) {
  return (
    <FullCalendar
      ref={calendarRef}
      plugins={[dayGrid, timeGrid, list, interaction]}
      locale={ru}
      timeZone="UTC"
      initialView="timeGridWeek"
      views={{ dayGridQuarter: { type: "dayGrid", duration: { months: 3 }, dateIncrement: { months: 3 }, buttonText: "Три месяца" } }}
      headerToolbar={{ left: "prev,next today", center: "title", right: "timeGridDay,timeGridWeek,dayGridMonth,dayGridQuarter" }}
      height={680}
      firstDay={1}
      now={localNow}
      lazyFetching={false}
      selectable
      eventDurationEditable={false}
      forceEventDuration={false}
      displayEventEnd={false}
      slotMinTime="00:00:00"
      slotMaxTime="24:00:00"
      scrollTime="08:00:00"
      eventMaxStack={3}
      dayMaxEvents={3}
      moreLinkText={(n) => `+ещё ${n}`}
      moreLinkContent={({ num }) => `+ещё ${num}`}
      eventDidMount={({ el, event }) => {
        const item = event.extendedProps.item as { tone?: string } | undefined;
        el.title = `${event.title}${item?.tone ? ` · ${({ red: "Просрочено / критично", yellow: "Скоро", green: "Под контролем", gray: "Завершено / отменено" })[item.tone]}` : " · Выбрать день для подробностей"}`;
      }}
      loading={loading}
      events={events}
      select={onSelectRange}
      eventClick={onEventClick}
      eventDrop={onEventDrop}
    />
  );
}
