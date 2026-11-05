import { notFound } from "next/navigation";
import { NotFoundError } from "@/shared/errors";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { requirePageActor } from "@/server/page-auth";
import { getOffer } from "@/modules/commercial-offers/application/offer-service";
import { getPrintIssuer, getPropertySourceUrl } from "@/modules/export/application/print-data";
import { listPropertyMedia } from "@/modules/properties/application/property-media-service";
import { PrintIssuer } from "@/modules/export/presentation/issuer";
import { PrintStyle } from "@/modules/export/presentation/print-style";
import { fmtMoney, fmtNum } from "@/server/format";
export default async function OfferPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor(); const { id } = await params;
  const { offer } = await getOffer(actor, id).catch(e => { if (e instanceof NotFoundError) notFound(); throw e; });
  const issuer = await getPrintIssuer(actor, offer.legalEntityId);
  const positions = await Promise.all(offer.items.map(async i => ({ ...i, sourceUrl: await getPropertySourceUrl(i.propertyId), photos: (await listPropertyMedia(actor, i.propertyId)).filter(m => m.kind === "photo").slice(0, 5) })));
  return <article className="crm-print space-y-4"><PrintStyle/><PrintIssuer issuer={issuer}/><h1>{offer.title ?? "Коммерческое предложение"}</h1>
    {offer.introText ? <p className="whitespace-pre-wrap">{offer.introText}</p> : null}
    {positions.map(i => <section key={i.id}><h2>{i.position}. {i.addressSnapshot}</h2>
      {i.areaSnapshot !== null ? <p>Площадь: {fmtNum(i.areaSnapshot, "м²")}</p> : null}
      {i.priceSnapshot !== null ? <p>Цена: {fmtMoney(i.priceSnapshot)}</p> : <p>Цена по запросу</p>}
      {i.termsSnapshot ? <p>{i.termsSnapshot}</p> : null}{i.comment ? <p>{i.comment}</p> : null}
      <div className="flex flex-wrap gap-2">{i.photos.map(m => <figure key={m.id}><img src={m.url} alt={m.caption ?? "Фото объекта"} />{m.caption ? <figcaption>{m.caption}</figcaption> : null}</figure>)}</div>
      <Link className="link" href={`/properties/${i.propertyId}`}>Карточка объекта</Link>
      {i.sourceUrl ? <p><a href={i.sourceUrl}>Источник объявления</a></p> : null}
    </section>)}
    <p>Ответственный: {offer.responsible.displayName}</p><Link className="btn" href={`/offers/${id}`}>Вернуться к КП</Link>
  </article>;
}
