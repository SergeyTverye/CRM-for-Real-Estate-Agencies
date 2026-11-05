"use client";
import { useRouter } from "next/navigation";
import { apiCall } from "@/ui/api-client";
import { useApiAction } from "@/ui/hooks";
import { FormErrorBanner } from "@/ui/form";

export function SelectionActions({ listingId, needId, comment, reviewStatus }: { listingId: string; needId: string; comment: string | null; reviewStatus: string }) {
  const action = useApiAction();
  const router = useRouter();
  return <div className="space-y-2"><div className="flex gap-2">
    <select aria-label="Состояние кандидата" className="input" value={reviewStatus} disabled={action.pending || reviewStatus === "proposed"} onChange={async e => {
      const result = await action.run(() => apiCall("POST", `/api/v1/property-search/listings/${listingId}/selection`, { needId, comment, reviewStatus: e.target.value }));
      if (result) router.refresh();
    }}><option value="candidate">Кандидат</option><option value="shortlisted">Отобран</option><option value="rejected">Отклонён</option><option value="proposed" disabled>Предложен</option></select>
    <button className="btn btn-secondary" disabled={action.pending || reviewStatus === "proposed"} onClick={async () => {
      const note = window.prompt("Комментарий к кандидату", comment ?? "");
      if (note === null) return;
      const result = await action.run(() => apiCall("POST", `/api/v1/property-search/listings/${listingId}/selection`, { needId, comment: note, reviewStatus }));
      if (result) router.refresh();
    }}>Комментарий</button>
  </div><FormErrorBanner error={action.error} /></div>;
}
