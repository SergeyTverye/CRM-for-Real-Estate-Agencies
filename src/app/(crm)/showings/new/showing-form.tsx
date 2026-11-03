"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "@/ui/api-client";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { Field, FormErrorBanner, SubmitButton } from "@/ui/form";
import { DateTimeInput, SelectInput, type Option } from "@/ui/client-kit";
import { NeedPicker, PropertySelect, type NeedLabels, type NeedPick, type PropertyPick } from "@/ui/domain/deal-pickers";

function defaultSlot(): string {
  const d = new Date(Date.now() + 24 * 3_600_000);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

export function NewShowingForm({
  initialNeed,
  initialProperty,
  labels,
  timeZone,
  users,
}: {
  initialNeed: NeedPick | null;
  initialProperty: PropertyPick | null;
  labels: NeedLabels;
  timeZone: string;
  users: Option[];
}) {
  const router = useRouter();
  const [need, setNeed] = useState<NeedPick | null>(initialNeed);
  const [property, setProperty] = useState<PropertyPick | null>(initialProperty);
  const [scheduledAt, setScheduledAt] = useState(defaultSlot);
  const [participantsText, setParticipants] = useState("");
  const [comment, setComment] = useState("");
  const [responsibleUserId, setResponsible] = useState("");
  const { pending, error, run, fieldError, setError } = useApiAction();
  const dirty = participantsText !== "" || comment !== "" || need?.id !== initialNeed?.id || property?.id !== initialProperty?.id;
  useUnsavedChangesWarning(dirty && !pending);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const fe: Record<string, string[]> = {};
        if (!need) fe.clientNeedId = ["Выберите потребность клиента"];
        if (!property) fe.propertyId = ["Выберите объект"];
        if (!scheduledAt) fe.scheduledAt = ["Укажите дату и время"];
        if (Object.keys(fe).length) {
          setError({ code: "VALIDATION_ERROR", message: "Проверьте заполнение формы", fieldErrors: fe });
          return;
        }
        const res = await run(() =>
          apiCall<{ id: string }>("POST", "/api/v1/showings", {
            clientNeedId: need!.id,
            propertyId: property!.id,
            scheduledAt,
            participantsText: participantsText || null,
            comment: comment || null,
            responsibleUserId: responsibleUserId || undefined,
          }),
        );
        if (res) router.push(`/showings/${res.id}`);
      }}
    >
      <FormErrorBanner error={error} />
      <Field label="Потребность клиента" required error={fieldError("clientNeedId")}>
        <NeedPicker value={need} onChange={setNeed} labels={labels} invalid={Boolean(fieldError("clientNeedId"))} />
      </Field>
      <Field label="Объект" required error={fieldError("propertyId")}>
        <PropertySelect value={property} onChange={setProperty} invalid={Boolean(fieldError("propertyId"))} />
      </Field>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Дата и время показа" required error={fieldError("scheduledAt")}>
          <DateTimeInput value={scheduledAt} onChange={setScheduledAt} timeZone={timeZone} invalid={Boolean(fieldError("scheduledAt"))} />
        </Field>
        {users.length ? (
          <Field label="Ответственный" hint="По умолчанию — ответственный за потребность" error={fieldError("responsibleUserId")} className="md:col-span-2">
            <SelectInput value={responsibleUserId} onChange={setResponsible} options={users} placeholder="Ответственный потребности" />
          </Field>
        ) : null}
      </div>
      <Field label="Участники" hint="Кто будет на показе: клиент, собственник, представитель" error={fieldError("participantsText")}>
        <input className="input" value={participantsText} onChange={(e) => setParticipants(e.target.value)} />
      </Field>
      <Field label="Комментарий" error={fieldError("comment")}>
        <textarea className="input min-h-20" value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <SubmitButton pending={pending}>Назначить показ</SubmitButton>
        <button type="button" className="btn" onClick={() => router.back()}>
          Отмена
        </button>
      </div>
    </form>
  );
}
