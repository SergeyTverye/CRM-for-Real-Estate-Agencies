"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "@/ui/api-client";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { FormErrorBanner, SubmitButton } from "@/ui/form";
import { NeedParamsFields, needParamsPayload, type NeedParamsOptions, type NeedParamsValue } from "@/ui/domain/need-params-fields";

export function NeedEditForm({ id, updatedAt, initial, options }: { id: string; updatedAt: string; initial: NeedParamsValue; options: NeedParamsOptions }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const { pending, error, run, fieldError } = useApiAction();
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  useUnsavedChangesWarning(dirty && !pending);
  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await run(() => apiCall("PATCH", `/api/v1/needs/${id}`, { ...needParamsPayload(v), expectedUpdatedAt: updatedAt }));
        if (res) {
          router.push(`/needs/${id}`);
          router.refresh();
        }
      }}
    >
      <FormErrorBanner error={error} />
      <p className="text-sm text-slate-500">Этап и статус меняются командами в карточке потребности; здесь — только параметры подбора.</p>
      <NeedParamsFields value={v} onChange={setV} options={options} fieldError={fieldError} />
      <div className="flex gap-2">
        <SubmitButton pending={pending}>Сохранить</SubmitButton>
        <button type="button" className="btn" onClick={() => router.back()}>
          Отмена
        </button>
      </div>
    </form>
  );
}
