import { notFound } from "next/navigation";
import { NotFoundError } from "@/shared/errors";
/* eslint-disable @next/next/no-img-element */
import { requirePageActor } from "@/server/page-auth";
import { getPropertyPrint, publicHttpUrl } from "@/modules/export/application/print-data";
import { PrintIssuer } from "@/modules/export/presentation/issuer";
import { PrintStyle } from "@/modules/export/presentation/print-style";
import { fmtMoney, fmtNum } from "@/server/format";
export default async function PropertyPrint({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ legalEntityId?: string }> }) {
  const actor = await requirePageActor(); const { id } = await params; const { legalEntityId } = await searchParams;
  const { property: p, issuer, photos } = await getPropertyPrint(actor, id, legalEntityId).catch(e => { if (e instanceof NotFoundError) notFound(); throw e; });
  const source = publicHttpUrl(p.sourceUrl);
  return <article className="crm-print space-y-3"><PrintStyle/><PrintIssuer issuer={issuer}/><h1>{p.addressText}</h1>
    {p.area !== null ? <p>Площадь: {fmtNum(p.area, "м²")}</p> : null}{p.price !== null ? <p>Цена: {fmtMoney(p.price)}</p> : null}
    {p.floor !== null ? <p>Этаж: {p.floor}{p.floorsTotal ? ` / ${p.floorsTotal}` : ""}</p> : null}
    {p.description ? <p className="whitespace-pre-wrap">{p.description}</p> : null}
    {source ? <p><a href={source}>Источник объявления</a></p> : null}
    {photos.map(m => <figure key={m.id}><img src={m.url} alt={m.caption ?? "Фото объекта"}/>{m.caption ? <figcaption>{m.caption}</figcaption> : null}</figure>)}
  </article>;
}
