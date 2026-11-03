"use client";

import Link from "next/link";
import { Field } from "../form";
import { SelectInput, type Option } from "../client-kit";
import type { ApiErrorBody } from "../api-client";

export interface ContactRow {
  contactType: string;
  value: string;
}

export interface NewClientValue {
  displayName: string;
  clientKind: string;
  notes: string;
  contacts: ContactRow[];
}

export const emptyClient = (): NewClientValue => ({ displayName: "", clientKind: "person", notes: "", contacts: [{ contactType: "phone", value: "" }] });

export function newClientPayload(v: NewClientValue, confirmDuplicate = false) {
  return {
    displayName: v.displayName,
    clientKind: v.clientKind,
    notes: v.notes || null,
    contacts: v.contacts.filter((c) => c.value.trim()).map((c, i) => ({ contactType: c.contactType, value: c.value, isPrimary: i === 0 })),
    confirmDuplicate,
  };
}

const CONTACT_TYPES: Option[] = [
  { value: "phone", label: "Телефон" },
  { value: "email", label: "E-mail" },
  { value: "other", label: "Другое" },
];

export function NewClientFields({ value, onChange, fieldError, prefix = "" }: { value: NewClientValue; onChange: (v: NewClientValue) => void; fieldError: (n: string) => string | undefined; prefix?: string }) {
  const p = (n: string) => `${prefix}${n}`;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Имя / наименование" required error={fieldError(p("displayName"))} className="md:col-span-2">
          <input className="input" value={value.displayName} onChange={(e) => onChange({ ...value, displayName: e.target.value })} />
        </Field>
        <Field label="Тип клиента">
          <SelectInput
            value={value.clientKind}
            onChange={(clientKind) => onChange({ ...value, clientKind })}
            options={[
              { value: "person", label: "Физическое лицо" },
              { value: "organization", label: "Организация" },
            ]}
          />
        </Field>
      </div>
      <div className="space-y-2">
        <span className="label">Контакты</span>
        {value.contacts.map((c, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="w-36">
              <SelectInput value={c.contactType} onChange={(contactType) => onChange({ ...value, contacts: value.contacts.map((x, j) => (j === i ? { ...x, contactType } : x)) })} options={CONTACT_TYPES} />
            </div>
            <div className="flex-1">
              <input
                className={`input ${fieldError(p(`contacts.${i}.value`)) ? "input-error" : ""}`}
                value={c.value}
                placeholder={c.contactType === "phone" ? "+7 900 000-00-00" : c.contactType === "email" ? "name@example.ru" : ""}
                onChange={(e) => onChange({ ...value, contacts: value.contacts.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
              />
              {fieldError(p(`contacts.${i}.value`)) ? <p className="field-error">{fieldError(p(`contacts.${i}.value`))}</p> : null}
            </div>
            {value.contacts.length > 1 ? (
              <button type="button" className="btn btn-sm btn-link" onClick={() => onChange({ ...value, contacts: value.contacts.filter((_, j) => j !== i) })}>
                Убрать
              </button>
            ) : null}
          </div>
        ))}
        <button type="button" className="btn btn-sm" onClick={() => onChange({ ...value, contacts: [...value.contacts, { contactType: "phone", value: "" }] })}>
          + Контакт
        </button>
      </div>
    </div>
  );
}

interface DuplicateCandidate {
  clientId: string;
  displayName: string;
  status: string;
  responsible: { displayName: string };
}

/**
 * Предупреждение о дубле (ТЗ 40.2). Для собственных клиентов/руководителя — список кандидатов
 * и явное подтверждение; при совпадении с чужим клиентом — только нейтральное сообщение.
 */
export function DuplicateNotice({
  error,
  onConfirm,
  onPick,
  onEscalate,
}: {
  error: ApiErrorBody | null;
  onConfirm?: () => void;
  onPick?: (c: DuplicateCandidate) => void;
  onEscalate?: () => void;
}) {
  if (!error) return null;
  if (error.code === "DUPLICATE_CONFLICT") {
    return (
      <div className="alert alert-warning space-y-2" role="alert">
        <div>{error.message}</div>
        {onEscalate ? (
          <button type="button" className="btn btn-sm" onClick={onEscalate}>
            Передать обращение руководителю
          </button>
        ) : null}
      </div>
    );
  }
  if (error.code !== "PROBABLE_DUPLICATE") return null;
  const candidates = (error.details?.candidates as DuplicateCandidate[] | undefined) ?? [];
  return (
    <div className="alert alert-warning space-y-2" role="alert">
      <div>{error.message}</div>
      <ul className="space-y-1">
        {candidates.map((c) => (
          <li key={c.clientId} className="flex flex-wrap items-center gap-2">
            <Link href={`/clients/${c.clientId}`} target="_blank" className="link font-medium">
              {c.displayName}
            </Link>
            <span className="text-xs text-slate-600">ответственный: {c.responsible.displayName}</span>
            {onPick ? (
              <button type="button" className="btn btn-sm" onClick={() => onPick(c)}>
                Выбрать этого клиента
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {onConfirm ? (
        <button type="button" className="btn btn-sm" onClick={onConfirm}>
          Это другой человек — создать нового клиента
        </button>
      ) : null}
    </div>
  );
}
