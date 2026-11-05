"use client";
import { useState } from "react";
import type { DuplicateGroupDto } from "@/modules/listing-duplicates/application/duplicate-service";
import { Modal } from "@/ui/client-kit";
import { apiCall } from "@/ui/api-client";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { Field, FormErrorBanner, SubmitButton } from "@/ui/form";

export const decisionLabels = { confirm: "Подтвердить совпадение", different: "Разные помещения", defer: "Решить позже", split: "Разъединить" } as const;
export type DuplicateDecision = keyof typeof decisionLabels;
export function DuplicateDecisionDialog({ group, decision, listingId, onClose, onDone, onReload }: {
  group: DuplicateGroupDto; decision: DuplicateDecision; listingId?: string;
  onClose: () => void; onDone: (group: DuplicateGroupDto) => void; onReload: () => void;
}) {
  const [comment, setComment] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const { pending, error, run, fieldError } = useApiAction();
  useUnsavedChangesWarning(!!comment || confirmed);
  return <Modal open onClose={() => { if (!pending) onClose(); }} title={decisionLabels[decision]}>
    <form className="space-y-4" onSubmit={async e => {
      e.preventDefault();
      const result = await run(() => apiCall<DuplicateGroupDto>("POST", `/api/v1/listing-duplicates/${group.id}/decisions`, {
        decision, ...(listingId ? { listingId } : {}), comment, confirmed, expectedUpdatedAt: group.updatedAt,
      }));
      if (result) onDone(result);
    }}>
      <p>{decision === "different" ? "Объявления сохранятся отдельно. Повторная обработка не соберёт их в одну группу." : decision === "split" ? "Объявление будет исключено из группы с сохранением истории. Алгоритм не вернёт его обратно." : decision === "confirm" ? "Вы подтверждаете, что объявления относятся к одному помещению. Каждый источник и его история сохраняются." : "Группа останется для последующей проверки."}</p>
      <FormErrorBanner error={error} onRetry={onReload} />
      <Field label="Комментарий (необязательно)" error={fieldError("comment")}><textarea className="input" value={comment} maxLength={1000} onChange={e => setComment(e.target.value)} /></Field>
      <label className="flex items-center gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} required />Подтверждаю выбранное решение</label>
      <SubmitButton pending={pending}>{decisionLabels[decision]}</SubmitButton>
      <button type="button" className="btn ml-2" disabled={pending} onClick={onClose}>Отмена</button>
    </form>
  </Modal>;
}
