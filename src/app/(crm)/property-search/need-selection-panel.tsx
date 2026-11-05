import { labelOf } from "@/shared/codebook";
import Link from "next/link";
import type { Actor } from "@/modules/auth/domain/actor";
import { listSelections } from "@/modules/property-search/application/listing-service";
import { Badge, Card, EmptyState } from "@/ui/components";
import { SelectionActions, SelectionCatalogAction } from "./selection-actions";

const statuses: Record<string, string> = { candidate: "Кандидат", shortlisted: "В коротком списке", rejected: "Отклонён", proposed: "Предложен клиенту" };
export async function NeedSelectionPanel({ actor, needId }: { actor: Actor; needId: string }) {
  const rows = await listSelections(actor, needId);
  return <Card title="Подборка (кандидаты)" actions={<Link className="btn btn-secondary" href={`/property-search?needId=${needId}`}>Подобрать объекты</Link>}>
    {!rows.length ? <EmptyState title="Кандидатов пока нет" hint="Добавьте объявления из поиска объектов. Это не создаёт объект каталога или факт предложения." /> :
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Объявление</th><th className="p-2">Статус</th><th className="p-2">Комментарий</th><th className="p-2">Каталог</th></tr></thead><tbody>{rows.map(row =>
        <tr key={row.id} className="border-t"><td className="p-2"><a className="link" href={row.listing.url} target="_blank" rel="noopener noreferrer">{row.listing.address ?? "Адрес не указан"} ↗</a><div className="text-xs text-slate-500">{labelOf("externalSource", row.listing.source)}</div></td><td className="p-2"><Badge>{statuses[row.reviewStatus]}</Badge><SelectionActions listingId={row.listingId} needId={needId} comment={row.comment} reviewStatus={row.reviewStatus} /></td><td className="p-2">{row.comment ?? "—"}</td><td className="p-2">{row.listing.propertyId ? <Link className="link" href={`/properties/${row.listing.propertyId}`}>Открыть объект</Link> : <SelectionCatalogAction listingId={row.listingId} address={row.listing.address} url={row.listing.url} />}</td></tr>)}</tbody></table></div>}
  </Card>;
}
