"use client";

import { useState } from "react";
import { FormErrorBanner } from "@/ui/form";
import type { ApiErrorBody } from "@/ui/api-client";
import { toast } from "@/ui/toast";

export function PdfButton({ id }: { id: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorBody | null>(null);
  async function download() {
    setPending(true); setError(null);
    try {
      const res = await fetch(`/api/v1/offers/${id}/pdf`, { signal: AbortSignal.timeout(60_000), credentials: "same-origin" });
      if (!res.ok) {
        const body = await res.json();
        setError(body.error ?? { code: "PDF_ERROR", message: "Не удалось сформировать PDF" });
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a"); a.href = url; a.download = `offer-${id}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("PDF подготовлен к скачиванию");
    } catch {
      setError({ code: "PDF_ERROR", message: "Не удалось скачать PDF. Проверьте подключение и повторите." });
    } finally { setPending(false); }
  }
  return <div><button type="button" className="btn" disabled={pending} aria-busy={pending} onClick={() => void download()}>{pending ? "Формирование PDF…" : "Скачать PDF"}</button><FormErrorBanner error={error}/></div>;
}
