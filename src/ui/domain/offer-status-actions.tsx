"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { labelOf } from "@/shared/codebook";
import { apiCall } from "../api-client";
import { useApiAction } from "../hooks";
import { Field, FormErrorBanner } from "../form";
import { DateTimeInput, Modal } from "../client-kit";

/**
 * Переходы статуса КП (ТЗ 37.20): подготовлено/отправлено требуют ИП/ООО при оформлении от имени
 * агентства. при отправке можно сразу поставить задачу «узнать решение».
 */

const TRANSITIONS: Record<string, string[]> = {
  draft: ["prepared", "sent", "archived"],
  prepared: ["sent", "draft", "archived"],
  sent: ["accepted", "rejected", "expired", "archived"],
  accepted: ["archived"],
  rejected: ["archived"],
  expired: ["archived"],
  archived: [],
};

const ACTION_LABEL: Record<string, string> = {
  draft: "Вернуть в черновик",
  prepared: "Подготовлено",
  sent: "Отправлено клиенту",
  accepted: "Принято",
  rejected: "Отклонено",
  expired: "Истекло",
  archived: "В архив",
};

function inDays(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setHours(11, 0, 0, 0);
  return d.toISOString();
}

export function OfferStatusActions({ offerId, updatedAt, status, hasLegalEntity, timeZone }: { offerId: string; updatedAt: string; status: string; hasLegalEntity: boolean; timeZone: string }) {
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(null);
  const [onBehalf, setOnBehalf] = useState(true);
  const [withFollowUp, setWithFollowUp] = useState(true);
  const [followTitle, setFollowTitle] = useState("Узнать решение клиента по КП");
  const [followDue, setFollowDue] = useState(() => inDays(3));
  const { pending, error, run, fieldError, setError } = useApiAction();
  const targets = TRANSITIONS[status] ?? [];
  if (!targets.length) return null;

  const open = (t: string) => {
    setError(null);
    setOnBehalf(true);
    setWithFollowUp(true);
    setFollowDue(inDays(3));
    setTarget(t);
  };

  async function submit() {
    if (!target) return;
    const body: Record<string, unknown> = { expectedUpdatedAt: updatedAt, status: target, onBehalfOfCompany: onBehalf };
    if (target === "sent" && withFollowUp) body.followUp = { title: followTitle, dueAt: followDue };
    const res = await run(() => apiCall("POST", `/api/v1/offers/${offerId}/status`, body));
    if (res !== undefined) {
      setTarget(null);
      router.refresh();
    }
  }

  const needsEntity = target === "prepared" || target === "sent";
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {targets.map((t) => (
          <button key={t} type="button" className={`btn btn-sm ${t === "sent" || (t === "prepared" && status === "draft") ? "btn-primary" : ""}`} onClick={() => open(t)}>
            {ACTION_LABEL[t] ?? labelOf("offerStatus", t)}
          </button>
        ))}
      </div>
      <Modal open={target !== null} onClose={() => setTarget(null)} title={target ? `Статус КП: ${labelOf("offerStatus", target)}` : ""}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <FormErrorBanner error={error} />
          {needsEntity ? (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={onBehalf} onChange={(e) => setOnBehalf(e.target.checked)} /> КП оформляется от имени агентства (ИП/ООО)
              </label>
              {onBehalf && !hasLegalEntity ? <div className="alert alert-warning">В предложении не выбрано ИП/ООО. Укажите его в черновике («Редактировать») перед подготовкой.</div> : null}
              {target === "prepared" ? <p className="text-sm text-slate-600">После подготовки состав объектов и юрлицо не меняются; для изменений верните КП в черновик.</p> : null}
            </>
          ) : null}
          {target === "sent" ? (
            <fieldset className="space-y-2 rounded-md border border-slate-200 p-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={withFollowUp} onChange={(e) => setWithFollowUp(e.target.checked)} /> Поставить задачу «узнать решение»
              </label>
              {withFollowUp ? (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <Field label="Задача" required error={fieldError("followUp.title")} className="md:col-span-2">
                    <input className="input" value={followTitle} onChange={(e) => setFollowTitle(e.target.value)} />
                  </Field>
                  <Field label="Срок" required error={fieldError("followUp.dueAt")}>
                    <DateTimeInput value={followDue} onChange={setFollowDue} timeZone={timeZone} />
                  </Field>
                </div>
              ) : null}
            </fieldset>
          ) : null}
          {target === "archived" ? <p className="text-sm text-slate-600">Предложение и его документы сохранятся, но изменить статус будет нельзя.</p> : null}
          {target === "accepted" || target === "rejected" || target === "expired" ? <p className="text-sm text-slate-600">Отметьте решение клиента. Продолжение работы по потребности ведите в её карточке.</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn" onClick={() => setTarget(null)}>
              Отмена
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending || (target === "sent" && withFollowUp && (!followTitle.trim() || !followDue))}>
              {pending ? "Сохранение…" : "Подтвердить"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
