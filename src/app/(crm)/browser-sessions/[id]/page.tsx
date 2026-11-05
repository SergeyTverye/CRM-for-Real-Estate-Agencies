import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/page-auth";
import { browserSessions } from "@/modules/browser-sessions/application/dependencies";
import { NotFoundError } from "@/shared/errors";
import { BrowserSessionView } from "@/ui/browser-session/session-view";
import { PageHeader } from "@/ui/components";

export const metadata = { title: "Проверка на площадке" };
export default async function BrowserSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor(); const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id)) notFound();
  try { await browserSessions().get(actor, id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  return <div><PageHeader title="Проверка на площадке" subtitle="Сотрудник проходит проверку вручную; затем CRM продолжает поиск" /><BrowserSessionView key={id} id={id} /></div>;
}
