"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { optionsOf } from "@/shared/codebook";
import { apiCall } from "../api-client";
import { useApiAction } from "../hooks";
import { Field, FormErrorBanner } from "../form";
import { Modal, SelectInput } from "../client-kit";
import { ClientPicker, type ClientPick } from "./need-pickers";

const ROLES = optionsOf("dealPartyRole");


export function DealPartyAddButton({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"client" | "external">("client");
  const [client, setClient] = useState<ClientPick | null>(null);
  const [externalPartyName, setExternal] = useState("");
  const [partyRole, setRole] = useState("buyer");
  const [comment, setComment] = useState("");
  const { pending, error, run, fieldError, setError } = useApiAction();

  const start = () => {
    setError(null);
    setKind("client");
    setClient(null);
    setExternal("");
    setRole("buyer");
    setComment("");
    setOpen(true);
  };

  async function submit() {
    if (kind === "client" && !client) {
      setError({ code: "VALIDATION_ERROR", message: "Проверьте заполнение формы", fieldErrors: { clientId: ["Выберите клиента"] } });
      return;
    }
    const body = kind === "client" ? { clientId: client!.id, partyRole, comment: comment || null } : { externalPartyName, partyRole, comment: comment || null };
    const res = await run(() => apiCall("POST", `/api/v1/deals/${dealId}/parties`, body));
    if (res !== undefined) {
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <>
      <button type="button" className="btn btn-sm" onClick={start}>
        + Участник
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Участник сделки">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <FormErrorBanner error={error} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Роль" required error={fieldError("partyRole")}>
              <SelectInput value={partyRole} onChange={setRole} options={ROLES} />
            </Field>
            <Field label="Кто">
              <SelectInput
                value={kind}
                onChange={(k) => setKind(k as "client" | "external")}
                options={[
                  { value: "client", label: "Клиент CRM" },
                  { value: "external", label: "Внешний участник" },
                ]}
              />
            </Field>
          </div>
          {kind === "client" ? (
            <Field label="Клиент" required error={fieldError("clientId")}>
              <ClientPicker value={client} onChange={setClient} invalid={Boolean(fieldError("clientId"))} />
            </Field>
          ) : (
            <Field label="Наименование / ФИО" required error={fieldError("externalPartyName") ?? fieldError("clientId")}>
              <input className="input" value={externalPartyName} onChange={(e) => setExternal(e.target.value)} />
            </Field>
          )}
          <Field label="Комментарий" error={fieldError("comment")}>
            <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Отмена
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Сохранение…" : "Добавить"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
