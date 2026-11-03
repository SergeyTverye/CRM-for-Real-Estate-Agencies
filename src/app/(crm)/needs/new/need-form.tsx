"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "@/ui/api-client";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { Field, FormErrorBanner, SubmitButton } from "@/ui/form";
import { NextActionFields, SelectInput, defaultNextAction, type NextActionValue, type Option } from "@/ui/client-kit";
import { NeedParamsFields, emptyNeedParams, needParamsPayload, type NeedParamsOptions, type NeedParamsValue } from "@/ui/domain/need-params-fields";
import { ClientPicker, type ClientPick } from "@/ui/domain/need-pickers";
import { NEED_TASK_TYPES } from "@/ui/domain/need-state-actions";

export function NewNeedForm({ initialClient, timeZone, users, options }: { initialClient: ClientPick | null; timeZone: string; users: Option[]; options: NeedParamsOptions }) {
  const router = useRouter();
  const [client, setClient] = useState<ClientPick | null>(initialClient);
  const [params, setParams] = useState<NeedParamsValue>(emptyNeedParams);
  const [next, setNext] = useState<NextActionValue>(() => defaultNextAction("Подобрать и предложить варианты"));
  const [responsibleUserId, setResponsible] = useState("");
  const { pending, error, run, fieldError, setError } = useApiAction();
  const dirty = JSON.stringify(params) !== JSON.stringify(emptyNeedParams());
  useUnsavedChangesWarning(dirty && !pending);

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!client) {
          setError({ code: "VALIDATION_ERROR", message: "Проверьте заполнение формы", fieldErrors: { clientId: ["Выберите клиента"] } });
          return;
        }
        const res = await run(() =>
          apiCall<{ id: string }>("POST", "/api/v1/needs", {
            ...needParamsPayload(params),
            clientId: client.id,
            responsibleUserId: responsibleUserId || undefined,
            nextAction: next,
          }),
        );
        if (res) router.push(`/needs/${res.id}`);
      }}
    >
      <FormErrorBanner error={error} />
      <Field label="Клиент" required error={fieldError("clientId")}>
        <ClientPicker value={client} onChange={setClient} invalid={Boolean(fieldError("clientId"))} />
      </Field>
      <NeedParamsFields value={params} onChange={setParams} options={options} fieldError={fieldError} />
      <NextActionFields value={next} onChange={setNext} timeZone={timeZone} taskTypes={NEED_TASK_TYPES} users={users.length ? users : undefined} errors={fieldError} />
      {users.length ? (
        <Field label="Ответственный за потребность" hint="По умолчанию — ответственный за клиента" error={fieldError("responsibleUserId")}>
          <SelectInput value={responsibleUserId} onChange={setResponsible} options={users} placeholder="Ответственный клиента" />
        </Field>
      ) : null}
      <div className="flex gap-2">
        <SubmitButton pending={pending}>Создать потребность</SubmitButton>
        <button type="button" className="btn" onClick={() => router.back()}>
          Отмена
        </button>
      </div>
    </form>
  );
}
