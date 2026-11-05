"use client";
import { useState } from "react";
import { ListingDialog } from "./listing-dialog";
import { useRouter } from "next/navigation";
import { apiCall } from "@/ui/api-client";
import { useApiAction } from "@/ui/hooks";
import { FormErrorBanner } from "@/ui/form";

export function SelectionActions({ listingId, needId, comment, reviewStatus }: { listingId: string; needId: string; comment: string | null; reviewStatus: string }) {
  const action = useApiAction();
  const router = useRouter();
  const [dialog, setDialog] = useState(false);
  return <div className="space-y-2"><div className="flex flex-wrap gap-2">
    <select aria-label="Состояние кандидата" className="input" value={reviewStatus} disabled={action.pending || reviewStatus === "proposed"} onChange={async e => {
      const result = await action.run(() => apiCall("POST", `/api/v1/property-search/listings/${listingId}/selection`, { needId, comment, reviewStatus: e.target.value }));
      if (result) router.refresh();
    }}><option value="candidate">Кандидат</option><option value="shortlisted">Отобран</option><option value="rejected">Отклонён</option><option value="proposed" disabled>Предложен</option></select>
    <button className="btn btn-secondary" disabled={action.pending || reviewStatus === "proposed"} onClick={() => setDialog(true)}>Комментарий</button>
    {dialog && <ListingDialog kind="selection" initialNote={comment ?? ""} onClose={() => setDialog(false)} onSubmit={async body => {
      const result = await apiCall("POST", `/api/v1/property-search/listings/${listingId}/selection`, { ...body, needId, reviewStatus });
      router.refresh(); return result;
    }} />}
  </div><FormErrorBanner error={action.error} /></div>;
}

export function SelectionCatalogAction({ listingId, address, url }: { listingId: string; address?: string | null; url?: string }) {
  const action = useApiAction();
  const router = useRouter();
  const [dialog, setDialog] = useState(false);
  return <div className="space-y-2"><span className="block text-xs text-slate-500">Не перенесён</span>
    <button className="btn btn-secondary" onClick={() => setDialog(true)}>В каталог CRM</button>
    {dialog && <ListingDialog kind="transfer" address={address} url={url} onClose={() => setDialog(false)} onSubmit={async body => {
      const result = await apiCall("POST", `/api/v1/property-search/listings/${listingId}/transfer`, body);
      router.refresh(); return result;
    }} />}<FormErrorBanner error={action.error} />
  </div>;
}
