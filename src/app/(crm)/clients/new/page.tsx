import { requirePageActor } from "@/server/page-auth";
import { userOptions } from "@/server/options";
import { Card, PageHeader } from "@/ui/components";
import { NewClientForm } from "./client-form";

export const metadata = { title: "Новый клиент" };

export default async function NewClientPage() {
  const actor = await requirePageActor();
  const users = actor.role === "manager" ? await userOptions() : [];
  return (
    <div className="max-w-3xl">
      <PageHeader title="Новый клиент" back={{ href: "/clients", label: "Клиенты" }} subtitle="Для входящего звонка удобнее «Создать → Обращение»: клиент создастся вместе с обращением." />
      <Card>
        <NewClientForm users={users} />
      </Card>
    </div>
  );
}
