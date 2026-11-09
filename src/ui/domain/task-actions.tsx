"use client";

import { requestConfirmation } from "@/ui/confirm-dialog";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiCallError, apiCall } from "../api-client";
import { useApiAction } from "../hooks";
import { Field, FormErrorBanner } from "../form";
import { DateTimeInput, Modal, NextActionFields, SelectInput, defaultNextAction, type NextActionValue, type Option } from "../client-kit";
import { optionsOf } from "@/shared/codebook";

const TASK_TYPES = optionsOf("taskType").filter((o) => o.value !== "postdeal");
const PRIORITIES = optionsOf("taskPriority");
const NEXT_STEP_CODES = ["NEXT_ACTION_REQUIRED", "RETURN_TASK_REQUIRED"];

/**
 * Завершение или отмена задачи с итогом и необязательным следующим шагом.
 * Если сервер сообщает, что это последнее действие активной/приостановленной потребности
 * (NEXT_ACTION_REQUIRED / RETURN_TASK_REQUIRED), форма делает следующий шаг обязательным.
 */
function CloseTaskForm({
  taskId,
  updatedAt,
  timeZone,
  mode,
  onClose,
}: {
  taskId: string;
  updatedAt: string;
  timeZone: string;
  mode: "complete" | "cancel";
  onClose: (done: boolean) => void;
}) {
  const [comment, setComment] = useState("");
  const [confirmOpenRequired, setConfirmOpenRequired] = useState(false);
  const [withNext, setWithNext] = useState(false);
  const [needIds, setNeedIds] = useState<string[]>([]);
  const [pauseChoice, setPauseChoice] = useState("return");
  const [stopReason, setStopReason] = useState("other");
  const [required, setRequired] = useState<null | string>(null);
  const [next, setNext] = useState<NextActionValue>(() => defaultNextAction("Следующий шаг"));
  const { pending, error, run, fieldError } = useApiAction();
  const showNext = pauseChoice !== "closed" && (withNext || required !== null);

  async function submit() {
    const url = `/api/v1/tasks/${taskId}/${mode === "complete" ? "complete" : "cancel"}`;
    const res = await run(async () => {
      try {
        return await apiCall("POST", url, { confirmOpenRequired, expectedUpdatedAt: updatedAt, resultComment: comment || null, nextTask: showNext ? { ...next, taskType: required === "RETURN_TASK_REQUIRED" && pauseChoice === "return" ? "pause_return" : next.taskType } : undefined,
          needChanges: required === "RETURN_TASK_REQUIRED" && pauseChoice !== "return" ? needIds.map(needId => ({ needId, change: { status: pauseChoice, cancelOpenTasks: false, ...(pauseChoice === "closed" ? { stopReasonCode: stopReason, stopComment: comment } : {}) } })) : undefined });
      } catch (e) {
        if (e instanceof ApiCallError && NEXT_STEP_CODES.includes(e.body.code)) {
          setRequired(e.body.code);
          if (e.body.code === "RETURN_TASK_REQUIRED") {
            setNeedIds((e.body.details?.needIds as string[] | undefined) ?? []);
            setNext(s => ({ ...s, taskType: "pause_return", title: "Возврат из паузы" }));
          }
        }
        throw e;
      }
    });
    if (res !== undefined) onClose(true);
  }

  const nextRequiredError = error && NEXT_STEP_CODES.includes(error.code) ? error : null;
  return (
    <div className="space-y-3">
      {error?.code === "OPEN_REQUIRED_CHECKLIST" ? <div className="alert alert-warning" role="alert"><p>{error.message}</p><label><input type="checkbox" checked={confirmOpenRequired} onChange={e => setConfirmOpenRequired(e.target.checked)} /> Завершить с открытыми обязательными пунктами</label><Link className="link ml-2" href={`/tasks/${taskId}`}>Открыть чек-лист</Link></div> : null}
      {nextRequiredError ? (
        <div className="alert alert-warning" role="alert">
          {nextRequiredError.message} Задайте {required === "RETURN_TASK_REQUIRED" ? "задачу возврата" : "следующий шаг"} ниже.
        </div>
      ) : (
        <FormErrorBanner error={error} />
      )}
      {required === "RETURN_TASK_REQUIRED" ? <Field label="Продолжение работы с потребностью">
        <SelectInput value={pauseChoice} onChange={v => { setPauseChoice(v); if (v === "active") setNext(s => ({ ...s, taskType: "call_or_contact" })); }} options={[
          { value: "return", label: "Создать новую задачу возврата" }, { value: "active", label: "Сменить статус: в работе" }, { value: "closed", label: "Сменить статус: закрыта" },
        ]} />
        {pauseChoice === "closed" ? <SelectInput value={stopReason} onChange={setStopReason} options={optionsOf("stopReason")} /> : null}
      </Field> : null}
      <Field label={mode === "complete" ? "Итог (комментарий)" : "Причина отмены"}>
        <textarea className="input min-h-20" value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showNext} disabled={required !== null} onChange={(e) => setWithNext(e.target.checked)} /> Создать следующий шаг
        {required !== null ? <span className="text-xs text-amber-700">(обязательно для потребности)</span> : null}
      </label>
      {showNext ? (
        <NextActionFields
          value={next}
          onChange={setNext}
          timeZone={timeZone}
          taskTypes={required === "RETURN_TASK_REQUIRED" && pauseChoice === "return" ? TASK_TYPES.filter(t => t.value === "pause_return") : TASK_TYPES}
          errors={fieldError}
          prefix="nextTask"
          heading={required === "RETURN_TASK_REQUIRED" ? "Задача возврата" : "Следующий шаг"}
        />
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={() => onClose(false)}>
          Назад
        </button>
        <button type="button" className={mode === "complete" ? "btn btn-primary" : "btn btn-danger"} disabled={pending} onClick={() => void submit()}>
          {pending ? "Сохранение…" : mode === "complete" ? "Выполнено" : "Отменить задачу"}
        </button>
      </div>
    </div>
  );
}

function RescheduleForm({ taskId, updatedAt, dueAt, timeZone, onClose }: { taskId: string; updatedAt: string; dueAt: string; timeZone: string; onClose: (done: boolean) => void }) {
  const [newDue, setNewDue] = useState(dueAt);
  const { pending, error, run, fieldError } = useApiAction();
  return (
    <div className="space-y-3">
      <FormErrorBanner error={error} />
      <Field label="Новый срок" error={fieldError("dueAt")}>
        <DateTimeInput value={newDue} onChange={setNewDue} timeZone={timeZone} />
      </Field>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={() => onClose(false)}>
          Отмена
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending || !newDue}
          onClick={async () => {
            const res = await run(() => apiCall("PATCH", `/api/v1/tasks/${taskId}`, { expectedUpdatedAt: updatedAt, dueAt: newDue }));
            if (res !== undefined) onClose(true);
          }}
        >
          Перенести
        </button>
      </div>
    </div>
  );
}

/**
 * Быстрые команды строки задачи (ТЗ 37.4): «выполнить» (с итогом и следующим шагом),
 * «перенести», при необходимости — «открыть».
 */
export function TaskQuickActions({ taskId, updatedAt, dueAt, timeZone, openHref }: { taskId: string; updatedAt: string; dueAt: string; timeZone: string; openHref?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "complete" | "reschedule">(null);
  const close = (done: boolean) => {
    setMode(null);
    if (done) router.refresh();
  };
  return (
    <div className="flex shrink-0 gap-1">
      <button type="button" className="btn btn-sm" onClick={() => setMode("complete")}>
        Выполнить
      </button>
      <button type="button" className="btn btn-sm" onClick={() => setMode("reschedule")}>
        Перенести
      </button>
      {openHref ? (
        <Link href={openHref} className="btn btn-sm">
          Открыть
        </Link>
      ) : null}
      <Modal open={mode === "complete"} onClose={() => setMode(null)} title="Выполнение задачи" wide>
        <CloseTaskForm taskId={taskId} updatedAt={updatedAt} timeZone={timeZone} mode="complete" onClose={close} />
      </Modal>
      <Modal open={mode === "reschedule"} onClose={() => setMode(null)} title="Перенос срока">
        <RescheduleForm taskId={taskId} updatedAt={updatedAt} dueAt={dueAt} timeZone={timeZone} onClose={close} />
      </Modal>
    </div>
  );
}

export interface TaskEditValue {
  title: string;
  description: string;
  dueAt: string;
  priority: string;
  status: string;
  responsibleUserId: string;
}

function TaskEditForm({
  taskId,
  updatedAt,
  initial,
  timeZone,
  users,
  onClose,
}: {
  taskId: string;
  updatedAt: string;
  initial: TaskEditValue;
  timeZone: string;
  users: Option[] | null;
  onClose: (done: boolean) => void;
}) {
  const [v, setV] = useState(initial);
  const { pending, error, run, fieldError } = useApiAction();
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const reassign = users && v.responsibleUserId !== initial.responsibleUserId;
        if (reassign && !await requestConfirmation("Передать задачу другому сотруднику? Изменение ответственного фиксируется в журнале.")) return;
        const res = await run(() =>
          apiCall("PATCH", `/api/v1/tasks/${taskId}`, {
            expectedUpdatedAt: updatedAt,
            title: v.title,
            description: v.description || null,
            dueAt: v.dueAt,
            priority: v.priority,
            status: v.status,
            ...(reassign ? { responsibleUserId: v.responsibleUserId } : {}),
          }),
        );
        if (res !== undefined) onClose(true);
      }}
    >
      <FormErrorBanner error={error} />
      <Field label="Что сделать" required error={fieldError("title")}>
        <input className="input" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
      </Field>
      <Field label="Описание" error={fieldError("description")}>
        <textarea className="input min-h-20" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
      </Field>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Срок" required error={fieldError("dueAt")}>
          <DateTimeInput value={v.dueAt} onChange={(dueAt) => setV({ ...v, dueAt })} timeZone={timeZone} invalid={Boolean(fieldError("dueAt"))} />
        </Field>
        <Field label="Приоритет" error={fieldError("priority")}>
          <SelectInput value={v.priority} onChange={(priority) => setV({ ...v, priority })} options={PRIORITIES} />
        </Field>
        <Field label="Состояние" error={fieldError("status")}>
          <SelectInput
            value={v.status}
            onChange={(status) => setV({ ...v, status })}
            options={[
              { value: "planned", label: "Запланирована" },
              { value: "in_progress", label: "В работе" },
            ]}
          />
        </Field>
      </div>
      {users ? (
        <Field label="Ответственный" error={fieldError("responsibleUserId")} hint="Риелтор может передать задачу себе или руководителю">
          <SelectInput value={v.responsibleUserId} onChange={(responsibleUserId) => setV({ ...v, responsibleUserId })} options={users} />
        </Field>
      ) : null}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className="btn" onClick={() => onClose(false)}>
          Отмена
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Сохранение…" : "Сохранить"}
        </button>
      </div>
    </form>
  );
}

/** Команды карточки задачи: выполнить, изменить/перенести (в т.ч. передать), отменить. */
export function TaskCardActions({
  taskId,
  updatedAt,
  initial,
  timeZone,
  users,
}: {
  taskId: string;
  updatedAt: string;
  initial: TaskEditValue;
  timeZone: string;
  /** Список для смены ответственного. null — передавать задачу нельзя. */
  users: Option[] | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "complete" | "edit" | "cancel">(null);
  const close = (done: boolean) => {
    setMode(null);
    if (done) router.refresh();
  };
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setMode("complete")}>
        Выполнить
      </button>
      <button type="button" className="btn" onClick={() => setMode("edit")}>
        Изменить / перенести
      </button>
      <button type="button" className="btn btn-danger" onClick={() => setMode("cancel")}>
        Отменить
      </button>
      <Modal open={mode === "complete"} onClose={() => setMode(null)} title="Выполнение задачи" wide>
        <CloseTaskForm taskId={taskId} updatedAt={updatedAt} timeZone={timeZone} mode="complete" onClose={close} />
      </Modal>
      <Modal open={mode === "cancel"} onClose={() => setMode(null)} title="Отмена задачи" wide>
        <CloseTaskForm taskId={taskId} updatedAt={updatedAt} timeZone={timeZone} mode="cancel" onClose={close} />
      </Modal>
      <Modal open={mode === "edit"} onClose={() => setMode(null)} title="Изменение задачи">
        <TaskEditForm taskId={taskId} updatedAt={updatedAt} initial={initial} timeZone={timeZone} users={users} onClose={close} />
      </Modal>
    </>
  );
}
