import Link from "next/link";
import type { Actor } from "@/modules/auth/domain/actor";
import { getContactControl } from "@/modules/requests/application/contact-control";
import { Card } from "@/ui/components";
import { fmtDateTime } from "@/server/format";

export async function ContactControl({ actor, userId }: { actor: Actor; userId?: string }) {
  const data = await getContactControl(actor, userId);
  return <div className="mb-4 grid gap-4 lg:grid-cols-2">
    <Card title={`Перспективные без следующего действия · ${data.requests.length}`}>
      {data.requests.length ? <ul>{data.requests.map(r => <li key={r.id}><Link className="link" href={`/requests/${r.id}`}>Обращение · {fmtDateTime(r.occurredAt)}</Link></li>)}</ul> : <p>Все перспективные обращения имеют актуальное действие.</p>}
    </Card>
    <Card title={`Просроченные контакты · ${data.overdue.length}`}>
      {data.overdue.length ? <ul>{data.overdue.map(t => <li key={t.id}><Link className="link" href={`/tasks/${t.id}`}>{t.title}</Link> · {fmtDateTime(t.dueAt)}</li>)}</ul> : <p>Просроченных контактов нет.</p>}
    </Card>
  </div>;
}
