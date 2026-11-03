import { requirePageActor } from "@/server/page-auth";
import { tz } from "@/server/format";
import { loadDictionaries, userOptions } from "@/server/options";
import { Card, PageHeader } from "@/ui/components";
import { loadNeedPrefill, loadPropertyPick, needLabels } from "@/ui/domain/deal-prefill";
import { NewShowingForm } from "./showing-form";

export const metadata = { title: "Новый показ" };

export default async function NewShowingPage({ searchParams }: { searchParams: Promise<{ needId?: string; propertyId?: string }> }) {
  const actor = await requirePageActor();
  const { needId, propertyId } = await searchParams;
  const [need, property, dicts] = await Promise.all([loadNeedPrefill(actor, needId), loadPropertyPick(actor, propertyId), loadDictionaries()]);
  const users = actor.role === "manager" ? await userOptions() : [];
  const unavailable = [needId && !need ? "потребность" : null, propertyId && !property ? "объект" : null].filter(Boolean);
  const closedNeed = need && !["active", "paused"].includes(need.pick.status);
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Назначить показ"
        back={need ? { href: `/needs/${need.pick.id}`, label: "Потребность" } : property ? { href: `/properties/${property.id}`, label: property.addressText } : { href: "/showings", label: "Показы" }}
        subtitle="Показ создаёт задачу-встречу в календаре ответственного и отмечает объект в подборе потребности."
      />
      {unavailable.length ? <div className="alert alert-warning mb-3">Не подставлено — запись не найдена или недоступна: {unavailable.join(", ")}.</div> : null}
      {closedNeed ? <div className="alert alert-warning mb-3">Потребность закрыта — показ можно назначить только по открытой потребности.</div> : null}
      <Card>
        <NewShowingForm initialNeed={closedNeed ? null : (need?.pick ?? null)} initialProperty={property} labels={needLabels(dicts)} timeZone={tz()} users={users} />
      </Card>
    </div>
  );
}
