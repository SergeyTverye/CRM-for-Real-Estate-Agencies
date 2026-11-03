"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "../api-client";
import { useApiAction } from "../hooks";
import { Field, FormErrorBanner } from "../form";
import { EntityPicker, Modal, SelectInput, type Option } from "../client-kit";
import { DuplicateNotice, emptyClient, NewClientFields, newClientPayload, type NewClientValue } from "./client-fields";

/** Запрос риелтора на доступ к контактам собственника чужого объекта (UC-12): создаёт задачу руководителю. */
export function RequestAccessButton({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const { pending, error, run } = useApiAction();
  const [sent, setSent] = useState(false);
  if (sent) {
    return (
      <div className="alert alert-success">
        Запрос отправлен руководителю — у него появилась задача. Контакты откроются после выдачи доступа.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending}
        onClick={async () => {
          const res = await run(() => apiCall("POST", `/api/v1/properties/${propertyId}/request-access`, {}));
          if (res !== undefined) {
            setSent(true);
            router.refresh();
          }
        }}
      >
        {pending ? "Отправка…" : "Запросить доступ"}
      </button>
      {error ? <div className={`alert ${error.code === "ALREADY_GRANTED" ? "alert-info" : "alert-error"}`}>{error.message}</div> : null}
    </div>
  );
}

/** Смена ответственного за объект (только руководитель). Пустое значение — объект без ответственного. */
export function ReassignPropertyButton({ propertyId, users, currentUserId }: { propertyId: string; users: Option[]; currentUserId: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState(currentUserId ?? "");
  const { pending, error, run, fieldError } = useApiAction();
  return (
    <>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => {
          setUserId(currentUserId ?? "");
          setOpen(true);
        }}
      >
        Сменить ответственного
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Ответственный за объект">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!window.confirm(userId ? "Назначить нового ответственного? Он получит доступ к контактам собственника." : "Оставить объект без ответственного?")) return;
            const res = await run(() => apiCall("POST", `/api/v1/properties/${propertyId}/reassign`, { responsibleUserId: userId || null }));
            if (res !== undefined) {
              setOpen(false);
              router.refresh();
            }
          }}
        >
          <FormErrorBanner error={error} />
          <Field label="Новый ответственный" error={fieldError("responsibleUserId")} hint="Изменение фиксируется в журнале аудита">
            <SelectInput value={userId} onChange={setUserId} options={users} placeholder="— без ответственного —" />
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Отмена
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Сохранение…" : "Сохранить"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

interface PickedClient {
  id: string;
  displayName: string;
  contacts?: { rawValue: string }[];
}

/** Добавление собственника: существующий доступный клиент или новый с проверкой дублей (ТЗ 40.2). */
export function AddOwnerButton({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [client, setClient] = useState<PickedClient | null>(null);
  const [newClient, setNewClient] = useState<NewClientValue>(emptyClient);
  const [ownerRole, setOwnerRole] = useState("");
  const [share, setShare] = useState("");
  const [comment, setComment] = useState("");
  const { pending, error, run, fieldError, setError } = useApiAction();
  // Ошибки нормализации контактов приходят без префикса newClient.
  const clientFieldError = (n: string) => fieldError(n) ?? fieldError(n.replace(/^newClient\./, ""));

  function reset() {
    setMode("existing");
    setClient(null);
    setNewClient(emptyClient());
    setOwnerRole("");
    setShare("");
    setComment("");
    setError(null);
  }

  async function submit(confirmDuplicate = false) {
    const body = {
      ...(mode === "existing" ? { clientId: client?.id } : { newClient: newClientPayload(newClient, confirmDuplicate) }),
      ownerRole: ownerRole || null,
      ownershipShare: share || null,
      comment: comment || null,
    };
    const res = await run(() => apiCall("POST", `/api/v1/properties/${propertyId}/owners`, body));
    if (res !== undefined) {
      setOpen(false);
      router.refresh();
    }
  }

  const dupError = error && ["PROBABLE_DUPLICATE", "DUPLICATE_CONFLICT"].includes(error.code) ? error : null;
  return (
    <>
      <button
        type="button"
        className="btn btn-sm btn-primary"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        + Собственник
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Собственник объекта" wide>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(false);
          }}
        >
          {!dupError ? <FormErrorBanner error={error} /> : null}
          <DuplicateNotice
            error={dupError}
            onConfirm={() => void submit(true)}
            onPick={(c) => {
              setMode("existing");
              setClient({ id: c.clientId, displayName: c.displayName });
              setError(null);
            }}
          />
          <div className="flex gap-4 text-sm" role="radiogroup" aria-label="Источник собственника">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} /> Существующий клиент
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} /> Новый клиент
            </label>
          </div>
          {mode === "existing" ? (
            <Field label="Клиент" required error={fieldError("clientId")} hint="Поиск среди доступных вам клиентов по имени или телефону">
              <EntityPicker<PickedClient>
                url="/api/v1/clients/pick"
                value={client}
                onChange={setClient}
                render={(c) => (
                  <span>
                    {c.displayName}
                    {c.contacts?.[0] ? <span className="ml-1 text-xs text-slate-500">{c.contacts[0].rawValue}</span> : null}
                  </span>
                )}
              />
            </Field>
          ) : (
            <NewClientFields value={newClient} onChange={setNewClient} fieldError={clientFieldError} prefix="newClient." />
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Роль" error={fieldError("ownerRole")} hint="Например: собственник, представитель">
              <input className="input" value={ownerRole} onChange={(e) => setOwnerRole(e.target.value)} />
            </Field>
            <Field label="Доля" error={fieldError("ownershipShare")} hint="От 0 до 1, например 0.5">
              <input className="input" inputMode="decimal" value={share} onChange={(e) => setShare(e.target.value)} />
            </Field>
            <Field label="Комментарий" error={fieldError("comment")}>
              <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Отмена
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending || (mode === "existing" && !client)}>
              {pending ? "Сохранение…" : "Добавить собственника"}
            </button>
          </div>
          {mode === "new" ? (
            <p className="text-xs text-slate-500">
              Новый клиент будет закреплён за ответственным по объекту. Полную карточку можно дополнить позже в разделе{" "}
              <Link className="link" href="/clients">
                «Клиенты»
              </Link>
              .
            </p>
          ) : null}
        </form>
      </Modal>
    </>
  );
}
