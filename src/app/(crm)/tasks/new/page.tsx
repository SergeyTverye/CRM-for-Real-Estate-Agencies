import { requirePageActor } from "@/server/page-auth";
import { getClientCard } from "@/modules/clients/application/client-queries";
import { getNeedCard } from "@/modules/needs/application/need-queries";
import { getPropertyCard } from "@/modules/properties/application/property-queries";
import { getShowing } from "@/modules/showings/application/showing-service";
import { listActiveUsersBrief } from "@/modules/users/application/users-service";
import { dictLabel } from "@/modules/dictionaries/application/dictionaries-service";
import { NotFoundError } from "@/shared/errors";
import { fmtDateTime, tz } from "@/server/format";
import { loadDictionaries } from "@/server/options";
import { Card, PageHeader } from "@/ui/components";
import { NewTaskForm, type ContextLink, type LinkKind } from "./task-form";

export const metadata = { title: "Новая задача" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PARAMS: { param: string; kind: LinkKind }[] = [
  { param: "clientId", kind: "client" },
  { param: "needId", kind: "need" },
  { param: "propertyId", kind: "property" },
  { param: "showingId", kind: "showing" },
  { param: "dealId", kind: "deal" },
  { param: "agreementId", kind: "agreement" },
  { param: "advertisementId", kind: "advertisement" },
  { param: "offerId", kind: "offer" },
];

const GENERIC: Record<LinkKind, { label: string; href: (id: string) => string }> = {
  client: { label: "Клиент", href: (id) => `/clients/${id}` },
  need: { label: "Потребность", href: (id) => `/needs/${id}` },
  property: { label: "Объект", href: (id) => `/properties/${id}` },
  showing: { label: "Показ", href: (id) => `/showings/${id}` },
  deal: { label: "Сделка", href: (id) => `/deals/${id}` },
  agreement: { label: "Договор", href: (id) => `/agreements/${id}` },
  advertisement: { label: "Рекламное объявление", href: (id) => `/advertisements/${id}` },
  offer: { label: "Коммерческое предложение", href: (id) => `/offers/${id}` },
};

async function orNull<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

export default async function NewTaskPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageActor();
  const sp = await searchParams;
  const dicts = await loadDictionaries();

  // Контекст из параметров: подпись связи берётся только из доступной пользователю записи.
  const links: ContextLink[] = [];
  const unavailable: string[] = [];
  for (const { param, kind } of PARAMS) {
    const raw = sp[param];
    const id = Array.isArray(raw) ? raw[0] : raw;
    if (!id) continue;
    if (!UUID_RE.test(id)) {
      unavailable.push(GENERIC[kind].label);
      continue;
    }
    let label: string | null = GENERIC[kind].label;
    if (kind === "client") label = (await orNull(() => getClientCard(actor, id)))?.displayName ?? null;
    if (kind === "need") {
      const card = await orNull(() => getNeedCard(actor, id));
      label = card ? `${card.need.client?.displayName ?? "Клиент (нет доступа)"}: ${dictLabel(dicts, "need_operation_type", card.need.operationType)} · ${dictLabel(dicts, "property_type", card.need.propertyType)}` : null;
    }
    if (kind === "property") label = (await orNull(() => getPropertyCard(actor, id)))?.property.addressText ?? null;
    if (kind === "showing") {
      const s = await orNull(() => getShowing(actor, id));
      label = s ? `${s.showing.property.addressText}, ${fmtDateTime(s.showing.scheduledAt)}` : null;
    }
    if (label === null) unavailable.push(GENERIC[kind].label);
    else links.push({ kind, id, label, kindLabel: GENERIC[kind].label, href: GENERIC[kind].href(id) });
  }

  // Риелтор назначает задачу себе или руководителю (эскалация). руководитель — любому активному сотруднику.
  const all = await listActiveUsersBrief();
  const users = all
    .filter((u) => actor.role === "manager" || u.id === actor.userId || u.roleCode === "manager")
    .map((u) => ({ value: u.id, label: `${u.id === actor.userId ? `${u.displayName} (я)` : u.displayName}${u.roleCode === "manager" ? " — руководитель" : ""}` }));

  const first = links[0];
  const returnHref = first ? (first.kind === "client" ? `${first.href}?tab=tasks` : first.href) : null;

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Новая задача"
        back={first ? { href: first.href, label: first.label } : { href: "/tasks", label: "Задачи" }}
        subtitle="Задача, звонок, напоминание или повторяющееся контрольное действие"
      />
      {unavailable.length ? (
        <div className="alert alert-warning mb-3">Связь не добавлена — запись не найдена или недоступна: {unavailable.join(", ")}.</div>
      ) : null}
      <Card>
        <NewTaskForm timeZone={tz()} isManager={actor.role === "manager"} users={users} selfId={actor.userId} contextLinks={links} returnHref={returnHref} />
      </Card>
    </div>
  );
}
