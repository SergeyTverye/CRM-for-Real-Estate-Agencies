"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "@/ui/api-client";
import { useApiAction } from "@/ui/hooks";
import { Field, FormErrorBanner, SubmitButton } from "@/ui/form";
import { SelectInput, type Option } from "@/ui/client-kit";
import { ClientPicker, type ClientPick } from "@/ui/domain/need-pickers";
import { optionsOf } from "@/shared/codebook";

const STATUSES = optionsOf("leadStatus");

/** Решение руководителя по обращению: привязка к клиенту, ответственный, статус (ТЗ 37.4.1, 40.1). */
export function ResolveRequestForm({ requestId, updatedAt, status, users, hasClient }: { requestId: string; updatedAt: string; status: string; users: Option[]; hasClient: boolean }) {
  const router = useRouter();
  const [client, setClient] = useState<ClientPick | null>(null);
  const [responsibleUserId, setResponsible] = useState("");
  const [statusCode, setStatus] = useState(status);
  const [comment, setComment] = useState("");
  const [saved, setSaved] = useState(false);
  const { pending, error, run, fieldError } = useApiAction();
  const changed = Boolean(client || responsibleUserId || statusCode !== status || comment.trim());

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(false);
        const res = await run(() =>
          apiCall("PATCH", `/api/v1/requests/${requestId}`, {
            expectedUpdatedAt: updatedAt,
            clientId: client?.id,
            responsibleUserId: responsibleUserId || undefined,
            statusCode: statusCode !== status ? statusCode : undefined,
            comment: comment.trim() || null,
          }),
        );
        if (res !== undefined) {
          setClient(null);
          setResponsible("");
          setComment("");
          setSaved(true);
          router.refresh();
        }
      }}
    >
      <FormErrorBanner error={error} />
      {saved ? <div className="alert alert-success">Решение сохранено.</div> : null}
      <Field label={hasClient ? "Перепривязать к клиенту" : "Привязать к клиенту"} error={fieldError("clientId")} hint="Ответственным за обращение станет ответственный клиента, если ниже не выбран другой">
        <ClientPicker value={client} onChange={setClient} />
      </Field>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Ответственный за обращение" error={fieldError("responsibleUserId")}>
          <SelectInput value={responsibleUserId} onChange={setResponsible} options={users} placeholder="Не менять" />
        </Field>
        <Field label="Статус" error={fieldError("statusCode")}>
          <SelectInput value={statusCode} onChange={setStatus} options={STATUSES} />
        </Field>
      </div>
      <Field label="Комментарий к решению" error={fieldError("comment")} hint="Добавляется к итогу обращения">
        <textarea className="input min-h-16" value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      <SubmitButton pending={pending} className={changed ? "" : "opacity-60"}>
        Сохранить решение
      </SubmitButton>
    </form>
  );
}
