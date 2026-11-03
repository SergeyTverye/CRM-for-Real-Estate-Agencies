import { requirePageActor } from "@/server/page-auth";
import { getClientCard } from "@/modules/clients/application/client-queries";
import { NotFoundError } from "@/shared/errors";
import { tz } from "@/server/format";
import { dictOptions, loadDictionaries, userOptions } from "@/server/options";
import { Card, PageHeader } from "@/ui/components";
import type { ClientPick } from "@/ui/domain/need-pickers";
import { NewNeedForm } from "./need-form";

export const metadata = { title: "Новая потребность" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewNeedPage({ searchParams }: { searchParams: Promise<{ clientId?: string }> }) {
  const actor = await requirePageActor();
  const { clientId } = await searchParams;
  let client: ClientPick | null = null;
  let archived = false;
  if (clientId && UUID_RE.test(clientId)) {
    try {
      const c = await getClientCard(actor, clientId);
      client = { id: c.id, displayName: c.displayName, contacts: c.contacts.slice(0, 1).map((x) => ({ rawValue: x.rawValue })) };
      archived = c.status === "archived";
    } catch (e) {
      if (!(e instanceof NotFoundError)) throw e;
    }
  }
  const dicts = await loadDictionaries();
  const users = actor.role === "manager" ? await userOptions() : [];
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Новая потребность"
        back={client ? { href: `/clients/${client.id}`, label: client.displayName } : { href: "/needs", label: "Потребности" }}
        subtitle="Новая потребность не заменяет прежние запросы клиента: у каждой — свой этап, статус и следующее действие."
      />
      {archived ? <div className="alert alert-warning mb-3">Клиент в архиве. Новая потребность возможна после восстановления клиента руководителем.</div> : null}
      <Card>
        <NewNeedForm
          initialClient={client}
          timeZone={tz()}
          users={users}
          options={{
            operationTypes: dictOptions(dicts, "need_operation_type"),
            propertyTypes: dictOptions(dicts, "property_type"),
            propertySubtypes: dictOptions(dicts, "property_subtype"),
            commercialPurposes: dictOptions(dicts, "commercial_purpose"),
          }}
        />
      </Card>
    </div>
  );
}
