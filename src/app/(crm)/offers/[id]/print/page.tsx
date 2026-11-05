import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { NotFoundError } from "@/shared/errors";
import { requirePageActor } from "@/server/page-auth";
import { getOfferPrintData } from "@/modules/commercial-offers/application/offer-print-data";
import { offerHtml } from "@/modules/export/presentation/offer-html";
import { PdfButton } from "../pdf-button";
import { PrintPreview } from "./print-preview";

export default async function OfferPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor();
  const { id } = await params;
  const h = await headers();
  // APP origin is only a hyperlink in exports; it is never requested by the renderer.
  const host = h.get("host") ?? "localhost";
  const baseUrl = `${h.get("x-forwarded-proto") === "https" ? "https" : "http"}://${host}`;
  const data = await getOfferPrintData(actor, id, baseUrl).catch(e => { if (e instanceof NotFoundError) notFound(); throw e; });
  return <div><div className="mb-4 flex flex-wrap items-center gap-3"><Link className="btn" href={`/offers/${id}`}>Вернуться к КП</Link><PdfButton id={id}/></div>
    <PrintPreview html={offerHtml(data)}/></div>;
}
