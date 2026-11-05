import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/page-auth";
import { getCollection } from "@/modules/collections/application/collection-service";
import { NotFoundError } from "@/shared/errors";
import { PageHeader } from "@/ui/components";
import { CollectionWorkspace } from "../workspace";
export default async function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor(); const { id } = await params;
  let card;
  try { card = await getCollection(actor, id); }
  catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  return <div><PageHeader title={card.name} back={{ href: "/collections", label: "Подборки" }} /><CollectionWorkspace card={JSON.parse(JSON.stringify(card))} /></div>;
}
