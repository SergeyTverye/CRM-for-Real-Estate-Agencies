"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { labelOf, optionsOf } from "@/shared/codebook";
import { apiCall } from "../api-client";
import { useApiAction } from "../hooks";
import { Field, FormErrorBanner } from "../form";
import { DateTimeInput, Modal, SelectInput, type Option } from "../client-kit";

/**
 * Закрытие сделки (UC-07, ТЗ 6.5, 25.4, 37.10): статус и дата + постсделочные задачи по шаблонам.
 * Ответственный по умолчанию — руководитель; руководитель может выбрать другого сотрудника,
 * риелтор — себя. Закрытие не архивирует клиента.
 */

export interface PostdealTemplateView {
  subtypeCode: string;
  title: string;
  offsetDays: number;
  recurrenceKind?: string;
  /** Срок по умолчанию: сегодня + offsetDays (рассчитан на сервере в часовом поясе экземпляра). */
  defaultDueAt: string;
}

interface TaskDraft {
  key: string;
  checked: boolean;
  subtypeCode: string;
  title: string;
  dueAt: string;
  responsibleUserId: string;
  recurrenceKind: string;
}

const SUBTYPES = optionsOf("postdealSubtype");
const RECURRENCE = optionsOf("recurrenceKind");

const fromTemplates = (templates: PostdealTemplateView[], checked: boolean): TaskDraft[] =>
  templates.map((t, i) => ({ key: `t${i}`, checked, subtypeCode: t.subtypeCode, title: t.title, dueAt: t.defaultDueAt, responsibleUserId: "", recurrenceKind: t.recurrenceKind ?? "none" }));

export function DealCloseButton({
  dealId,
  updatedAt,
  templates,
  responsibleOptions,
  timeZone,
  defaultExtraDueAt,
}: {
  dealId: string;
  updatedAt: string;
  templates: PostdealTemplateView[];
  /** Кого можно назначить вместо руководителя (руководителю — все сотрудники, риелтору — он сам). */
  responsibleOptions: Option[];
  timeZone: string;
  defaultExtraDueAt: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"completed" | "cancelled">("completed");
  const [closedAt, setClosedAt] = useState("");
  const [comment, setComment] = useState("");
  const [tasks, setTasks] = useState<TaskDraft[]>(() => fromTemplates(templates, true));
  const { pending, error, run, fieldError, setError } = useApiAction();

  const start = () => {
    setError(null);
    setStatus("completed");
    setClosedAt(new Date().toISOString());
    setComment("");
    setTasks(fromTemplates(templates, true));
    setOpen(true);
  };
  const setTask = (i: number, patch: Partial<TaskDraft>) => setTasks((s) => s.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const chosen = tasks.filter((t) => t.checked);

  async function submit() {
    const selected = tasks.map((t, i) => ({ t, i })).filter(({ t }) => t.checked);
    const fe: Record<string, string[]> = {};
    selected.forEach(({ t, i }) => {
      if (!t.title.trim()) fe[`tasks.${i}.title`] = ["Укажите задачу"];
      if (!t.dueAt) fe[`tasks.${i}.dueAt`] = ["Укажите срок"];
    });
    if (Object.keys(fe).length) {
      setError({ code: "VALIDATION_ERROR", message: "Проверьте постсделочные задачи", fieldErrors: fe });
      return;
    }
    const res = await run(() =>
      apiCall("POST", `/api/v1/deals/${dealId}/close`, {
        expectedUpdatedAt: updatedAt,
        status,
        closedAt: closedAt || null,
        comment: comment || null,
        postdealTasks: selected.map(({ t }) => ({
          subtypeCode: t.subtypeCode,
          title: t.title.trim(),
          dueAt: t.dueAt,
          responsibleUserId: t.responsibleUserId || undefined,
          recurrenceKind: t.recurrenceKind || "none",
        })),
      }),
    );
    if (res !== undefined) {
      setOpen(false);
      router.refresh();
    }
  }

  // Ошибки сервера по задачам приходят как postdealTasks.<индекс среди выбранных>.<поле>.
  const taskError = (i: number, field: string) => {
    const pos = tasks.slice(0, i).filter((t) => t.checked).length;
    return fieldError(`tasks.${i}.${field}`) ?? fieldError(`postdealTasks.${pos}.${field}`);
  };

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={start}>
        Закрыть сделку
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Закрытие сделки" wide>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <FormErrorBanner error={error} />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Итог" required>
              <SelectInput
                value={status}
                onChange={(v) => {
                  const s = v as "completed" | "cancelled";
                  setStatus(s);
                  setTasks((list) => list.map((t) => ({ ...t, checked: s === "completed" })));
                }}
                options={[
                  { value: "completed", label: "Сделка завершена" },
                  { value: "cancelled", label: "Сделка отменена" },
                ]}
              />
            </Field>
            <Field label="Дата закрытия" error={fieldError("closedAt")}>
              <DateTimeInput value={closedAt} onChange={setClosedAt} timeZone={timeZone} />
            </Field>
            <Field label="Комментарий" error={fieldError("comment")}>
              <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
          </div>
          <p className="text-xs text-slate-500">Закрытие сделки не архивирует клиента: карточка клиента, история, документы и комиссии сохраняются.</p>

          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold text-slate-800">Постсделочные задачи</legend>
            <p className="text-xs text-slate-500">Отметьте нужные. Ответственный по умолчанию — руководитель{responsibleOptions.length ? "; при необходимости выберите другого сотрудника" : ""}.</p>
            {tasks.map((t, i) => (
              <div key={t.key} className={`rounded-md border p-2.5 ${t.checked ? "border-brand-100 bg-brand-50/40" : "border-slate-200"}`}>
                <div className="grid grid-cols-1 items-end gap-2 md:grid-cols-12">
                  <label className="flex items-center gap-2 pb-2 text-sm md:col-span-1">
                    <input type="checkbox" checked={t.checked} onChange={(e) => setTask(i, { checked: e.target.checked })} aria-label={`Создать задачу «${t.title}»`} />
                  </label>
                  <Field label={labelOf("postdealSubtype", t.subtypeCode)} error={taskError(i, "title")} className="md:col-span-4">
                    <input className="input" value={t.title} disabled={!t.checked} onChange={(e) => setTask(i, { title: e.target.value })} />
                  </Field>
                  <Field label="Срок" error={taskError(i, "dueAt")} className="md:col-span-3">
                    <DateTimeInput value={t.dueAt} onChange={(dueAt) => setTask(i, { dueAt })} timeZone={timeZone} />
                  </Field>
                  <Field label="Ответственный" error={taskError(i, "responsibleUserId")} className="md:col-span-2">
                    <SelectInput value={t.responsibleUserId} onChange={(v) => setTask(i, { responsibleUserId: v })} options={responsibleOptions} placeholder="Руководитель" disabled={!t.checked} />
                  </Field>
                  <Field label="Повтор" className="md:col-span-2">
                    <SelectInput value={t.recurrenceKind} onChange={(v) => setTask(i, { recurrenceKind: v })} options={RECURRENCE} disabled={!t.checked} />
                  </Field>
                </div>
                {t.key.startsWith("x") ? (
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-xs text-slate-500">Вид:</span>
                    <select className="input w-auto py-1 text-xs" value={t.subtypeCode} onChange={(e) => setTask(i, { subtypeCode: e.target.value })}>
                      {SUBTYPES.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
            ))}
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setTasks((s) => [...s, { key: `x${s.length}`, checked: true, subtypeCode: "other", title: "", dueAt: defaultExtraDueAt, responsibleUserId: "", recurrenceKind: "none" }])}
            >
              + Другая задача
            </button>
          </fieldset>

          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-xs text-slate-500">Будет создано задач: {chosen.length}</span>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Отмена
            </button>
            <button type="submit" className={`btn ${status === "cancelled" ? "btn-danger" : "btn-primary"}`} disabled={pending}>
              {pending ? "Сохранение…" : status === "cancelled" ? "Отменить сделку" : "Закрыть сделку"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
