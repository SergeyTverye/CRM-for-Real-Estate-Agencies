"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiCall } from "@/ui/api-client";
import { useApiAction } from "@/ui/hooks";
import { DateTimeInput } from "@/ui/client-kit";
import { Field, FormErrorBanner } from "@/ui/form";
import { groupNotifications } from "@/modules/notifications/domain/notification-rules";
import { formatDateTime } from "@/shared/time";

type List = { items: { id: string; kind: string; title: string; detail: string; triggerAt: string; state: string; link: string }[]; total: number; page: number; pageSize: number };
export function NotificationsClient({ list, preference, timeZone }: { list: List; preference: { leadMinutes: number }; timeZone: string }) {
  const searchParams = useSearchParams();
  const router = useRouter(), action = useApiAction();
  const [lead, setLead] = useState(preference.leadMinutes), [snooze, setSnooze] = useState<{ id: string; until: string } | null>(null);
  const refresh = () => { router.refresh(); window.dispatchEvent(new Event("notifications:changed")); };
  async function mutate(url: string, body: unknown = {}, method = "POST") {
    const result = await action.run(() => apiCall(method,url,body));
    if (result) { setSnooze(null); refresh(); }
  }
  const pageHref = (page: number) => { const params = new URLSearchParams(searchParams.toString()); params.set("page", String(page)); return `/notifications?${params}`; };
  const groups = groupNotifications(list.items, timeZone);
  return <div className="space-y-4">
    <div className="flex flex-wrap justify-between gap-3"><h1 className="text-xl font-semibold">Уведомления · {list.total}</h1>
      <button className="btn" disabled={action.pending} onClick={() => void mutate("/api/v1/notifications/read-all")}>Прочитать все</button></div>
    <FormErrorBanner error={action.error} onRetry={refresh} />
    <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); void mutate("/api/v1/notifications/preferences", { leadMinutes: lead }, "PUT"); }}>
      <Field label="Напоминать заранее"><select className="input" value={[0,15,60,1440].includes(lead) ? lead : "custom"} onChange={e => setLead(e.target.value === "custom" ? 30 : Number(e.target.value))}>
        <option value="0">В момент события</option><option value="15">За 15 минут</option><option value="60">За 1 час</option><option value="1440">За 1 день</option><option value="custom">Свой интервал</option></select></Field>
      <Field label="Минут до события"><input className="input" type="number" min="0" max="525600" value={lead} onChange={e => setLead(Number(e.target.value))} /></Field>
      <button className="btn" disabled={action.pending}>Сохранить настройку</button>
    </form>
    <div className="flex gap-3"><Link href="/notifications">Все</Link><Link href="/notifications?state=delivered">Непрочитанные</Link><Link href="/notifications?state=read">Прочитанные</Link></div>
    {list.items.length ? <div className="space-y-3">{groups.map((group, index) => <details key={group.key} open={index === 0} className="rounded border bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">{group.day} · {group.label} · {group.items.length}</summary>
      <ul className="divide-y">{group.items.map(n => <li key={n.id} className="flex flex-wrap items-center gap-3 p-3">
        <div className="min-w-0 flex-1"><Link className={n.state === "delivered" ? "link font-semibold" : "link"} href={n.link}>{n.title}</Link>
          {n.detail ? <p className="mt-1 text-sm text-slate-600">{n.detail}</p> : null}<p className="text-xs text-slate-500">Уведомление: {formatDateTime(n.triggerAt,timeZone)}</p></div>
        <div className="ml-auto flex gap-2">{n.state !== "read" && <button className="btn btn-sm" disabled={action.pending} onClick={() => void mutate(`/api/v1/notifications/${n.id}/read`)}>Прочитать</button>}
          <button className="btn btn-sm" disabled={action.pending} onClick={() => setSnooze({ id: n.id, until: new Date(Date.now()+3600000).toISOString() })}>Напомнить позже</button></div>
      </li>)}</ul>
    </details>)}</div> : <p className="rounded border p-6">Уведомлений пока нет. Новые напоминания появятся автоматически.</p>}
    {snooze && <form className="flex flex-wrap items-end gap-3 rounded border p-4" onSubmit={e => { e.preventDefault(); void mutate(`/api/v1/notifications/${snooze.id}/snooze`,{ until: snooze.until }); }}>
      <Field label="Напомнить в"><DateTimeInput timeZone={timeZone} value={snooze.until} onChange={until => setSnooze({ ...snooze, until })} /></Field>
      <button className="btn btn-primary" disabled={action.pending}>Отложить</button><button type="button" className="btn" onClick={() => setSnooze(null)}>Отмена</button>
    </form>}
    <nav className="flex gap-4" aria-label="Страницы уведомлений">
      {list.page > 1 && <Link href={pageHref(list.page-1)}>← Назад</Link>}
      <span>Страница {list.page}</span>{list.page*list.pageSize < list.total && <Link href={pageHref(list.page+1)}>Далее →</Link>}
    </nav>
  </div>;
}
