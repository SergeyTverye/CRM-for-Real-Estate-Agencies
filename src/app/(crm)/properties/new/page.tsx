import { requirePageActor } from "@/server/page-auth";
import { Card, PageHeader } from "@/ui/components";
import { PropertyForm } from "../property-form";
import { propertyFormOptions } from "../form-options";

export const metadata = { title: "Новый объект" };

export default async function NewPropertyPage() {
  const actor = await requirePageActor();
  const options = await propertyFormOptions(actor, { create: true });
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Новый объект"
        back={{ href: "/properties", label: "Объекты" }}
        subtitle="Собственника и его контакты добавьте после сохранения — во вкладке «Собственники»."
      />
      <Card>
        <PropertyForm mode="create" options={options} />
      </Card>
    </div>
  );
}
