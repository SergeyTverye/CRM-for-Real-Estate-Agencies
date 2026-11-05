import Link from "next/link";
import type { Actor } from "@/modules/auth/domain/actor";
import { getContactControl } from "@/modules/requests/application/contact-control";
import { dictLabel, loadDictionaries } from "@/modules/dictionaries/application/dictionaries-service";
import { Card } from "@/ui/components";
import { fmtDateTime } from "@/server/format";

export async function ContactControl({ actor, userId }: { actor: Actor; userId?: string }) {
  const [data, dicts] = await Promise.all([getContactControl(actor, userId), loadDictionaries()]);
  return <div className="mb-4 grid gap-4 xl:grid-cols-2">
    <Card title={`Перспективные без следующего действия · ${data.requests.length}`}>
      {data.requests.length ? <div className="max-h-64 overflow-auto"><table className="table"><thead><tr><th style={{ whiteSpace: "normal" }}>Клиент / обращение</th><th style={{ whiteSpace: "normal" }}>Источник / содержание</th><th style={{ whiteSpace: "normal" }}>Следующий срок</th><th style={{ whiteSpace: "normal" }}>Ответственный</th></tr></thead><tbody>{data.requests.map(r => <tr key={r.id}>
        <td><Link className="link" href={`/requests/${r.id}`}>{r.client?.displayName ?? "Обращение"}</Link><div className="text-xs text-slate-500">{fmtDateTime(r.occurredAt)}</div></td>
        <td><span>{dictLabel(dicts, "lead_source", r.sourceCode)}</span><p className="max-w-lg text-xs text-slate-600">{r.summary ?? "—"}</p></td><td>Не назначен</td><td>{r.responsible.displayName}</td>
      </tr>)}</tbody></table></div> : <p>Все перспективные обращения имеют актуальное действие.</p>}
    </Card>
    <Card title={`Просроченные контакты · ${data.overdue.length}`}>
      {data.overdue.length ? <div className="max-h-64 overflow-auto"><table className="table"><thead><tr><th style={{ whiteSpace: "normal" }}>Клиент / контакт</th><th style={{ whiteSpace: "normal" }}>Содержание</th><th style={{ whiteSpace: "normal" }}>Срок</th><th style={{ whiteSpace: "normal" }}>Ответственный</th></tr></thead><tbody>{data.overdue.map(t => {
        const client = t.clientLinks[0]?.client ?? t.needLinks[0]?.need.client;
        return <tr key={t.id}><td>{client ? <Link className="link" href={`/clients/${client.id}`}>{client.displayName}</Link> : "—"}</td><td><Link className="link" href={`/tasks/${t.id}`}>{t.title}</Link>{t.description ? <p className="max-w-lg text-xs text-slate-600">{t.description}</p> : null}</td><td className="whitespace-nowrap text-red-700">{fmtDateTime(t.dueAt)}</td><td>{t.responsible.displayName}</td></tr>;
      })}</tbody></table></div> : <p>Просроченных контактов нет.</p>}
    </Card>
  </div>;
}
