import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/page-auth";
import { getClientCard } from "@/modules/clients/application/client-queries";
import { NotFoundError } from "@/shared/errors";
import { Card, PageHeader } from "@/ui/components";
import { ClientEditForm } from "./edit-form";

export const metadata = { title: "Редактирование клиента" };

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor();
  const { id } = await params;
  const client = await getClientCard(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  return (
    <div className="max-w-3xl">
      <PageHeader title="Редактирование клиента" back={{ href: `/clients/${id}`, label: client.displayName }} />
      <Card>
        <ClientEditForm
          id={id}
          updatedAt={client.updatedAt.toISOString()}
          initial={{ displayName: client.displayName, clientKind: client.clientKind, notes: client.notes ?? "", status: client.status }}
        />
      </Card>
    </div>
  );
}
