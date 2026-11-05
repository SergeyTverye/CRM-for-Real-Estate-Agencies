"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { PdfButton } from "../pdf-button";
import { FormErrorBanner } from "@/ui/form";
import type { ApiErrorBody } from "@/ui/api-client";

export function PrintPreview({ id, html }: { id: string; html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorBody | null>(null);
  async function docx() {
    setPending(true); setError(null);
    try {
      const result = await fetch(`/api/v1/offers/${id}/document`, { method: "POST", credentials: "same-origin" });
      const body = await result.json();
      if (!result.ok) { setError(body.error ?? { code: "DOCX_ERROR", message: "Не удалось сформировать DOCX" }); return; }
      const file = await fetch(`/api/v1/documents/${body.id}/download`, { credentials: "same-origin" });
      if (!file.ok) throw new Error("Download failed");
      const url = URL.createObjectURL(await file.blob());
      const a = document.createElement("a"); a.href = url; a.download = `offer-${id}.docx`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError({ code: "DOCX_ERROR", message: "Не удалось скачать DOCX. Повторите попытку." }); }
    finally { setPending(false); }
  }
  return <><nav aria-label="Действия с печатным предложением" className="mb-4 flex flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap">
    <Link className="btn" href={`/offers/${id}`}>Вернуться к КП</Link><span aria-hidden="true">·</span>
    <button type="button" className="btn" onClick={() => frame.current?.contentWindow?.print()}>Печать A4</button><span aria-hidden="true">·</span>
    <PdfButton id={id}/><span aria-hidden="true">·</span>
    <button type="button" className="btn" disabled={pending} aria-busy={pending} onClick={() => void docx()}>{pending ? "Формирование DOCX…" : "Скачать DOCX"}</button>
    </nav><FormErrorBanner error={error}/>
    <iframe ref={frame} title="Печатное коммерческое предложение A4" srcDoc={html} sandbox="allow-same-origin allow-modals" className="mt-4 h-[80vh] w-full rounded-md border border-slate-200 bg-white" /></>;
}
