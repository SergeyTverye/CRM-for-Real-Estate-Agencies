"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "@/ui/api-client";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { Field, FormErrorBanner, SubmitButton } from "@/ui/form";
import { SelectInput } from "@/ui/client-kit";

export interface ClientEditValue {
  displayName: string;
  clientKind: string;
  notes: string;
  status: string;
}

export function ClientEditForm({ id, initial, updatedAt }: { id: string; initial: ClientEditValue; updatedAt: string }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const { pending, error, run, fieldError } = useApiAction();
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  useUnsavedChangesWarning(dirty && !pending);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await run(() =>
          apiCall("PATCH", `/api/v1/clients/${id}`, {
            expectedUpdatedAt: updatedAt,
            displayName: v.displayName,
            clientKind: v.clientKind,
            notes: v.notes || null,
            ...(v.status !== initial.status ? { status: v.status } : {}),
          }),
        );
        if (res) {
          router.push(`/clients/${id}`);
          router.refresh();
        }
      }}
    >
      <FormErrorBanner error={error} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Имя / наименование" required error={fieldError("displayName")} className="md:col-span-2">
          <input className="input" value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.target.value })} />
        </Field>
        <Field label="Тип клиента">
          <SelectInput value={v.clientKind} onChange={(clientKind) => setV({ ...v, clientKind })} options={[{ value: "person", label: "Физическое лицо" }, { value: "organization", label: "Организация" }]} />
        </Field>
      </div>
      {initial.status !== "archived" ? (
        <Field label="Статус" hint="«Неактивный» — нет текущей работы; новое обращение или потребность вернут клиента в активные">
          <SelectInput value={v.status} onChange={(status) => setV({ ...v, status })} options={[{ value: "active", label: "Активный" }, { value: "inactive", label: "Неактивный" }]} />
        </Field>
      ) : null}
      <Field label="Комментарий" error={fieldError("notes")}>
        <textarea className="input min-h-24" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
      </Field>
      <div className="flex gap-2">
        <SubmitButton pending={pending}>Сохранить</SubmitButton>
        <button type="button" className="btn" onClick={() => router.back()}>
          Отмена
        </button>
      </div>
    </form>
  );
}
