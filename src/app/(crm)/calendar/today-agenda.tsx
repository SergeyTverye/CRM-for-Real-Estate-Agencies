import Link from "next/link";
import type { Actor } from "@/modules/auth/domain/actor";
import { todayAgenda } from "@/modules/calendar/application/calendar-service";
import { fmtDateTime, tz } from "@/server/format";
import { AgendaActions } from "./agenda-actions";
export async function TodayAgenda({ actor, employee }: { actor: Actor; employee?: string }) {
  const view = await todayAgenda(actor, employee);
  return <section className="mb-4 rounded-lg border bg-white p-4">
    <div className="mb-3 flex justify-between"><h2 className="font-semibold">Повестка дня и ближайшие показы</h2><Link href="/calendar">Календарь →</Link></div>
    {view.items.length ? <ul className="divide-y">{view.items.map(e => <li key={e.id} className="flex flex-wrap items-center gap-3 py-2">
      <span className="text-sm text-slate-500">{fmtDateTime(e.start)}{e.end ? ` — ${fmtDateTime(e.end)}` : ""}</span>
      {e.url ? <Link href={e.url}>{e.title}</Link> : <span>{e.title}</span>}
      <AgendaActions item={e} timeZone={tz()} />
    </li>)}</ul> : <p>На сегодня событий нет.</p>}
    {employee ? <p className="mt-3 text-sm text-slate-600">Свободные интервалы 09:00–18:00 (только интервальная занятость): {view.free.length ? view.free.map(f => `${fmtDateTime(f.start)} — ${fmtDateTime(f.end)}`).join("; ") : "нет"}.</p> : <p className="mt-3 text-sm text-slate-500">Для свободных интервалов выберите сотрудника.</p>}
  </section>;
}
