"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "@/ui/api-client";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { Field, FormErrorBanner, SubmitButton } from "@/ui/form";
import { SelectInput, type Option } from "@/ui/client-kit";
import { DuplicateNotice, emptyClient, NewClientFields, newClientPayload, type NewClientValue } from "@/ui/domain/client-fields";

export function NewClientForm({ users }: { users: Option[] }) {
  const router = useRouter();
  const [value, setValue] = useState<NewClientValue>(emptyClient);
  const [responsibleUserId, setResponsible] = useState("");
  const { pending, error, run, fieldError } = useApiAction();
  const dirty = value.displayName !== "" || value.contacts.some((c) => c.value);
  useUnsavedChangesWarning(dirty && !pending);

  async function submit(confirmDuplicate = false) {
    const res = await run(() =>
      apiCall<{ id: string }>("POST", "/api/v1/clients", { ...newClientPayload(value, confirmDuplicate), responsibleUserId: responsibleUserId || undefined }),
    );
    if (res) router.push(`/clients/${res.id}`);
  }

  const dupError = error && ["PROBABLE_DUPLICATE", "DUPLICATE_CONFLICT"].includes(error.code) ? error : null;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
    >
      {!dupError ? <FormErrorBanner error={error} /> : null}
      <DuplicateNotice error={dupError} onConfirm={() => void submit(true)} onPick={(c) => router.push(`/clients/${c.clientId}`)} />
      <NewClientFields value={value} onChange={setValue} fieldError={fieldError} />
      <Field label="Комментарий">
        <textarea className="input min-h-20" value={value.notes} onChange={(e) => setValue({ ...value, notes: e.target.value })} />
      </Field>
      {users.length ? (
        <Field label="Ответственный" hint="По умолчанию — вы">
          <SelectInput value={responsibleUserId} onChange={setResponsible} options={users} placeholder="Я" />
        </Field>
      ) : null}
      <div className="flex gap-2">
        <SubmitButton pending={pending}>Создать клиента</SubmitButton>
      </div>
    </form>
  );
}
