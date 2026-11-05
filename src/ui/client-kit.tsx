"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "./api-client";
import { useApiAction } from "./hooks";
import { Field, FormErrorBanner } from "./form";
import { fromDateTimeLocalValue, toDateTimeLocalValue } from "@/shared/time";

/** Клиентские строительные блоки форм и быстрых действий. */

export interface Option {
  value: string;
  label: string;
}

/** Кнопка изменяющего действия: вызов API → обновление страницы. */
export function ActionButton({
  method = "POST",
  url,
  body,
  label,
  confirm,
  className,
  onDone,
  pendingLabel,
}: {
  method?: string;
  url: string;
  body?: unknown;
  label: React.ReactNode;
  confirm?: string;
  className?: string;
  onDone?: (data: unknown) => void;
  pendingLabel?: string;
}) {
  const router = useRouter();
  const { pending, error, run } = useApiAction();
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        className={className ?? "btn btn-sm"}
        disabled={pending}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          const res = await run(() => apiCall(method, url, body ?? (method === "DELETE" ? undefined : {})));
          if (res !== undefined) {
            onDone?.(res);
            router.refresh();
          }
        }}
      >
        {pending ? (pendingLabel ?? "…") : label}
      </button>
      {error ? <span className="text-xs text-red-600">{error.message}</span> : null}
    </span>
  );
}

export function DateTimeInput({ value, onChange, timeZone, id, invalid }: { value: string; onChange: (iso: string) => void; timeZone: string; id?: string; invalid?: boolean }) {
  return (
    <input
      id={id}
      type="datetime-local"
      className={`input ${invalid ? "input-error" : ""}`}
      aria-invalid={invalid || undefined}
      value={value ? toDateTimeLocalValue(value, timeZone) : ""}
      onChange={(e) => onChange(e.target.value ? fromDateTimeLocalValue(e.target.value, timeZone) : "")}
    />
  );
}

export function SelectInput({ value, onChange, options, placeholder, invalid, disabled }: { value: string; onChange: (v: string) => void; options: Option[]; placeholder?: string; invalid?: boolean; disabled?: boolean }) {
  return (
    <select className={`input ${invalid ? "input-error" : ""}`} aria-invalid={invalid || undefined} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export interface NextActionValue {
  title: string;
  dueAt: string;
  taskType: string;
  priority: string;
  responsibleUserId?: string;
  description?: string;
}

export function defaultNextAction(title = "Связаться с клиентом", hours = 24, taskType = "call_or_contact"): NextActionValue {
  const d = new Date(Date.now() + hours * 3_600_000);
  d.setMinutes(0, 0, 0);
  return { title, dueAt: d.toISOString(), taskType, priority: "normal" };
}

/** Блок «Следующее действие» — используется во всех командах, где нужен next action. */
export function NextActionFields({
  value,
  onChange,
  timeZone,
  taskTypes,
  users,
  errors,
  prefix = "nextAction",
  heading = "Следующее действие",
}: {
  value: NextActionValue;
  onChange: (v: NextActionValue) => void;
  timeZone: string;
  taskTypes: Option[];
  users?: Option[];
  errors?: (name: string) => string | undefined;
  prefix?: string;
  heading?: string;
}) {
  const err = (f: string) => errors?.(`${prefix}.${f}`);
  return (
    <fieldset className="rounded-md border border-brand-100 bg-brand-50/40 p-3">
      <legend className="px-1 text-xs font-semibold text-brand-700">{heading}</legend>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label="Что сделать" error={err("title")} required className="md:col-span-2">
          <input className={`input ${err("title") ? "input-error" : ""}`} value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} />
        </Field>
        <Field label="Срок" error={err("dueAt")} required>
          <DateTimeInput value={value.dueAt} onChange={(dueAt) => onChange({ ...value, dueAt })} timeZone={timeZone} invalid={Boolean(err("dueAt"))} />
        </Field>
        <Field label="Тип" error={err("taskType")}>
          <SelectInput value={value.taskType} onChange={(taskType) => onChange({ ...value, taskType })} options={taskTypes} />
        </Field>
        {users ? (
          <Field label="Ответственный" error={err("responsibleUserId")} className="md:col-span-2">
            <SelectInput value={value.responsibleUserId ?? ""} onChange={(v) => onChange({ ...value, responsibleUserId: v || undefined })} options={users} placeholder="По умолчанию" />
          </Field>
        ) : null}
      </div>
    </fieldset>
  );
}

/** Модальное окно на основе <dialog>. */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={titleId} onClose={onClose} className={`crm-dialog ${wide ? "w-[min(960px,95vw)]" : "w-[min(560px,95vw)]"}`}>
      <div className="card-header">
        <h2 id={titleId} className="card-title">{title}</h2>
        <button type="button" className="btn btn-sm btn-link" onClick={onClose} aria-label="Закрыть">
          ✕
        </button>
      </div>
      <div className="card-body min-h-0 overflow-y-auto">{open ? children : null}</div>
    </dialog>
  );
}

/** Поиск и выбор записи через API (клиенты, объекты). */
export function EntityPicker<T extends { id: string }>({
  url,
  value,
  onChange,
  render,
  placeholder,
  invalid,
}: {
  url: string;
  value: T | null;
  onChange: (v: T | null) => void;
  render: (item: T) => React.ReactNode;
  placeholder?: string;
  invalid?: boolean;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<T[]>([]);
  const [open, setOpen] = useState(false);
  const load = useCallback(
    async (term: string) => {
      const res = await apiCall<{ items: T[] }>("GET", `${url}${url.includes("?") ? "&" : "?"}q=${encodeURIComponent(term)}`).catch(() => ({ items: [] as T[] }));
      setItems(res.items);
    },
    [url],
  );
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void load(q), 200);
    return () => clearTimeout(t);
  }, [q, open, load]);
  if (value) {
    return (
      <div className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm ${invalid ? "border-red-500" : "border-slate-300"}`}>
        <div className="min-w-0 truncate">{render(value)}</div>
        <button type="button" className="btn btn-sm btn-link" onClick={() => onChange(null)}>
          Изменить
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input
        className={`input ${invalid ? "input-error" : ""}`}
        placeholder={placeholder ?? "Начните вводить для поиска…"}
        value={q}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setQ(e.target.value)}
      />
      {open && items.length ? (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(it);
                setOpen(false);
              }}
            >
              {render(it)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Небольшая форма в модальном окне: поля описываются конфигурацией.
 * Подходит для быстрых действий карточек (добавить контакт, причина, комментарий).
 */
export interface QuickField {
  name: string;
  label: string;
  type?: "text" | "textarea" | "select" | "datetime" | "date" | "checkbox" | "number";
  options?: Option[];
  required?: boolean;
  placeholder?: string;
  initial?: string | boolean;
  hint?: string;
}

export function QuickFormButton({
  label,
  title,
  fields,
  url,
  method = "POST",
  timeZone,
  extraBody,
  transform,
  buttonClassName,
  submitLabel = "Сохранить",
  onDone,
}: {
  label: React.ReactNode;
  title: string;
  fields: QuickField[];
  url: string;
  method?: string;
  timeZone: string;
  extraBody?: Record<string, unknown>;
  transform?: (values: Record<string, unknown>) => Record<string, unknown>;
  buttonClassName?: string;
  submitLabel?: string;
  onDone?: (data: unknown) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const init = () => Object.fromEntries(fields.map((f) => [f.name, f.initial ?? (f.type === "checkbox" ? false : "")]));
  const [values, setValues] = useState<Record<string, unknown>>(init);
  const { pending, error, run, fieldError, setError } = useApiAction();
  const set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }));
  return (
    <>
      <button
        type="button"
        className={buttonClassName ?? "btn btn-sm"}
        onClick={() => {
          setValues(init());
          setError(null);
          setOpen(true);
        }}
      >
        {label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const cleaned = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ""));
            const body = { ...(transform ? transform(cleaned) : cleaned), ...extraBody };
            const res = await run(() => apiCall(method, url, body));
            if (res !== undefined) {
              setOpen(false);
              onDone?.(res);
              router.refresh();
            }
          }}
        >
          <FormErrorBanner error={error} />
          {fields.map((f) => (
            <Field key={f.name} label={f.label} required={f.required} error={fieldError(f.name)} hint={f.hint}>
              {f.type === "textarea" ? (
                <textarea className="input min-h-20" value={String(values[f.name] ?? "")} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value)} />
              ) : f.type === "select" ? (
                <SelectInput value={String(values[f.name] ?? "")} onChange={(v) => set(f.name, v)} options={f.options ?? []} placeholder={f.required ? undefined : "—"} />
              ) : f.type === "datetime" ? (
                <DateTimeInput value={String(values[f.name] ?? "")} onChange={(v) => set(f.name, v)} timeZone={timeZone} />
              ) : f.type === "checkbox" ? (
                <input type="checkbox" checked={Boolean(values[f.name])} onChange={(e) => set(f.name, e.target.checked)} />
              ) : (
                <input
                  className="input"
                  type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
                  value={String(values[f.name] ?? "")}
                  placeholder={f.placeholder}
                  onChange={(e) => set(f.name, e.target.value)}
                />
              )}
            </Field>
          ))}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Отмена
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Сохранение…" : submitLabel}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
