import { requirePageActor } from "@/server/page-auth";
import { listLegalEntities } from "@/modules/legal-entities/application/legal-entity-service";
import { PageHeader } from "@/ui/components";
import { LegalEntitiesPanel } from "@/ui/domain/admin-legal-entities";

export const metadata = { title: "Юридические субъекты" };

export default async function AdminLegalEntitiesPage() {
  const actor = await requirePageActor({ manager: true });
  const items = await listLegalEntities(actor);
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Юридические субъекты (ИП/ООО)"
        back={{ href: "/admin", label: "Администрирование" }}
        subtitle="При подписании договора и оформлении сделки выбирается субъект, от имени которого действует агентство."
      />
      <LegalEntitiesPanel items={items.map((i) => ({ id: i.id, entityType: i.entityType, displayName: i.displayName, isActive: i.isActive, usage: i.usage }))} />
    </div>
  );
}
