"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { optionsOf } from "@/shared/codebook";
import { ApiCallError, apiCall } from "../api-client";
import { useApiAction } from "../hooks";
import { Field, FormErrorBanner } from "../form";
import { DateTimeInput, Modal, NextActionFields, SelectInput, defaultNextAction, type NextActionValue, type Option } from "../client-kit";
import { NEED_TASK_TYPES } from "./need-state-actions";

/**
 * «Зафиксировать результат» показа (UC-05, ТЗ 37.8): результат + переход потребности
 * и требуемое продолжение одной командой POST /api/v1/showings/[id]/result.
 * Если сервер сообщает, что у потребности не осталось действия (NEXT_ACTION_REQUIRED /
 * RETURN_TASK_REQUIRED), форма делает следующий шаг обязательным.
 */

type ShowingOutcome = "completed" | "cancelled" | "no_show";
type NeedMode = "active" | "paused" | "closed" | "success";

const RESULTS = optionsOf("showingResult");
const STAGES = optionsOf("needStage");
const STOP_REASONS = optionsOf("stopReason");

const OUTCOMES: { value: ShowingOutcome; label: string }[] = [
  { value: "completed", label: "Показ состоялся" },
  { value: "cancelled", label: "Отменён" },
  { value: "no_show", label: "Неявка клиента" },
];

const MODES: { value: NeedMode; label: string; hint: string }[] = [
  { value: "active", label: "Оставить в работе", hint: "со следующим действием" },
  { value: "paused", label: "Пауза", hint: "с задачей возврата" },
  { value: "closed", label: "Закрыть", hint: "с причиной остановки" },
  { value: "success", label: "Успешно завершена", hint: "потребность достигнута" },
];

function suggestedNext(outcome: ShowingOutcome, result: string): NextActionValue {
  if (outcome !== "completed") return defaultNextAction("Связаться с клиентом и перенести показ", 24);
  switch (result) {
    case "interested":
      return defaultNextAction("Обсудить с клиентом условия по объекту", 24);
    case "negotiation":
      return defaultNextAction("Провести переговоры по объекту", 24);
    case "thinking":
      return defaultNextAction("Узнать решение клиента после показа", 48);
    case "rejected":
      return defaultNextAction("Подобрать новые варианты", 24);
    default:
      return defaultNextAction("Связаться с клиентом по итогам показа", 24);
  }
}

export interface ShowingNeedState {
  status: string;
  stage: string;
}

export function ShowingResultButton({
  showingId,
  updatedAt,
  scheduledAt,
  timeZone,
  need,
  users,
}: {
  showingId: string;
  updatedAt: string;
  scheduledAt: string;
  timeZone: string;
  /** null — потребность уже закрыта, продолжение не требуется. */
  need: ShowingNeedState | null;
  users?: Option[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Зафиксировать результат
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Результат показа" wide>
        <ShowingResultForm showingId={showingId} updatedAt={updatedAt} scheduledAt={scheduledAt} timeZone={timeZone} need={need} users={users} onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />
      </Modal>
    </>
  );
}

export function ShowingResultForm({
  showingId,
  updatedAt,
  scheduledAt,
  timeZone,
  need,
  users,
  onDone,
  onCancel,
}: {
  showingId: string;
  updatedAt: string;
  scheduledAt: string;
  timeZone: string;
  need: ShowingNeedState | null;
  users?: Option[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<ShowingOutcome>("completed");
  const [occurredAt, setOccurredAt] = useState(() => (new Date(scheduledAt) < new Date() ? scheduledAt : new Date().toISOString()));
  const [resultCode, setResultCode] = useState("");
  const [comment, setComment] = useState("");
  const [mode, setMode] = useState<NeedMode>(need?.status === "paused" ? "paused" : "active");
  const [stage, setStage] = useState("");
  const [withTask, setWithTask] = useState(true);
  const [forced, setForced] = useState<null | "NEXT_ACTION_REQUIRED" | "RETURN_TASK_REQUIRED">(null);
  const [next, setNext] = useState<NextActionValue>(() => suggestedNext("completed", ""));
  const [nextEdited, setNextEdited] = useState(false);
  const [returnTask, setReturnTask] = useState<NextActionValue>(() => defaultNextAction("Вернуться к потребности", 24 * 7));
  const [stopReasonCode, setStopReason] = useState("");
  const [stopComment, setStopComment] = useState("");
  const [cancelOpenTasks, setCancelOpenTasks] = useState(true);
  const { pending, error, run, fieldError } = useApiAction();

  const retitle = (o: ShowingOutcome, r: string) => {
    if (!nextEdited) setNext(suggestedNext(o, r));
  };

  // Задача обязательна: смена статуса на active/paused или сервер сообщил, что продолжения нет.
  const taskRequired = (mode === "active" && (need?.status !== "active" || forced === "NEXT_ACTION_REQUIRED")) || (mode === "paused" && (need?.status !== "paused" || forced === "RETURN_TASK_REQUIRED"));
  const showTask = withTask || taskRequired;

  function needChange(): Record<string, unknown> | undefined {
    if (!need) return undefined;
    const stageChange = stage && stage !== need.stage ? stage : undefined;
    let change: Record<string, unknown>;
    switch (mode) {
      case "active":
        change = { status: need.status !== "active" ? "active" : undefined, stage: stageChange, nextAction: showTask ? next : undefined };
        break;
      case "paused":
        change = showTask ? { status: "paused", stage: stageChange, returnTask } : { stage: stageChange };
        break;
      case "closed":
        change = { status: "closed", stopReasonCode: stopReasonCode || null, stopComment: stopComment || null, cancelOpenTasks };
        break;
      case "success":
        change = { status: "success", stage: stageChange, cancelOpenTasks };
        break;
    }
    const meaningful = Object.entries(change).filter(([, v]) => v !== undefined);
    return meaningful.length ? Object.fromEntries(meaningful) : undefined;
  }

  async function submit() {
    const body = {
      expectedUpdatedAt: updatedAt,
      status: outcome,
      occurredAt: outcome === "completed" ? occurredAt || null : null,
      resultCode: outcome === "completed" ? resultCode || null : null,
      comment: comment || null,
      needChange: needChange(),
    };
    const res = await run(async () => {
      try {
        return await apiCall("POST", `/api/v1/showings/${showingId}/result`, body);
      } catch (e) {
        if (e instanceof ApiCallError && (e.body.code === "NEXT_ACTION_REQUIRED" || e.body.code === "RETURN_TASK_REQUIRED")) {
          setForced(e.body.code);
          setMode(e.body.code === "NEXT_ACTION_REQUIRED" ? "active" : "paused");
          setWithTask(true);
        }
        throw e;
      }
    });
    if (res !== undefined) {
      onDone();
      router.refresh();
    }
  }

  const nextRequiredError = error && (error.code === "NEXT_ACTION_REQUIRED" || error.code === "RETURN_TASK_REQUIRED") ? error : null;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {nextRequiredError ? (
        <div className="alert alert-warning" role="alert">
          {nextRequiredError.message} Задайте {nextRequiredError.code === "RETURN_TASK_REQUIRED" ? "задачу возврата" : "следующий шаг"} ниже.
        </div>
      ) : (
        <FormErrorBanner error={error} />
      )}

      <fieldset>
        <legend className="label">Итог показа</legend>
        <div className="flex flex-wrap gap-4">
          {OUTCOMES.map((o) => (
            <label key={o.value} className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="showing-outcome"
                checked={outcome === o.value}
                onChange={() => {
                  setOutcome(o.value);
                  retitle(o.value, resultCode);
                }}
              />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>

      {outcome === "completed" ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Результат" required error={fieldError("resultCode")}>
            <SelectInput
              value={resultCode}
              onChange={(v) => {
                setResultCode(v);
                retitle(outcome, v);
              }}
              options={RESULTS}
              placeholder="—"
              invalid={Boolean(fieldError("resultCode"))}
            />
          </Field>
          <Field label="Фактические дата и время" error={fieldError("occurredAt")}>
            <DateTimeInput value={occurredAt} onChange={setOccurredAt} timeZone={timeZone} invalid={Boolean(fieldError("occurredAt"))} />
          </Field>
        </div>
      ) : null}

      <Field label="Комментарий" hint="Что понравилось/не понравилось клиенту, договорённости" error={fieldError("comment")}>
        <textarea className="input min-h-20" value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>

      {need ? (
        <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-xs font-semibold text-slate-600">Продолжение работы по потребности</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {MODES.map((m) => (
              <label key={m.value} className="flex items-center gap-1.5 text-sm">
                <input type="radio" name="need-mode" checked={mode === m.value} onChange={() => setMode(m.value)} />
                <span>
                  {m.label} <span className="text-xs text-slate-500">— {m.hint}</span>
                </span>
              </label>
            ))}
          </div>

          {mode !== "closed" ? (
            <Field label="Этап потребности" error={fieldError("needChange.stage")} className="max-w-sm">
              <SelectInput value={stage} onChange={setStage} options={STAGES.filter((o) => o.value !== need.stage)} placeholder="Не менять" />
            </Field>
          ) : null}

          {mode === "active" ? (
            <>
              {!taskRequired ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={withTask} onChange={(e) => setWithTask(e.target.checked)} /> Создать следующее действие
                </label>
              ) : null}
              {showTask ? (
                <NextActionFields
                  value={next}
                  onChange={(v) => {
                    setNext(v);
                    setNextEdited(true);
                  }}
                  timeZone={timeZone}
                  taskTypes={NEED_TASK_TYPES}
                  users={users}
                  errors={fieldError}
                  prefix="needChange.nextAction"
                  heading="Следующий шаг"
                />
              ) : (
                <p className="text-xs text-slate-500">Если других открытых действий по потребности нет, система попросит назначить следующий шаг.</p>
              )}
            </>
          ) : null}

          {mode === "paused" ? (
            <>
              {!taskRequired ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={withTask} onChange={(e) => setWithTask(e.target.checked)} /> Новая задача возврата
                </label>
              ) : (
                <p className="text-sm text-slate-600">Пауза — осознанный перерыв. Назначьте задачу возврата с датой, чтобы потребность не потерялась.</p>
              )}
              {showTask ? (
                <NextActionFields value={returnTask} onChange={setReturnTask} timeZone={timeZone} taskTypes={NEED_TASK_TYPES} users={users} errors={fieldError} prefix="needChange.returnTask" heading="Задача возврата" />
              ) : null}
              {fieldError("needChange.returnTask") ? <p className="field-error">{fieldError("needChange.returnTask")}</p> : null}
            </>
          ) : null}

          {mode === "closed" ? (
            <>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Причина остановки" required error={fieldError("needChange.stopReasonCode")}>
                  <SelectInput value={stopReasonCode} onChange={setStopReason} options={STOP_REASONS} placeholder="—" invalid={Boolean(fieldError("needChange.stopReasonCode"))} />
                </Field>
                <Field label="Комментарий к причине" required={stopReasonCode === "other"} error={fieldError("needChange.stopComment")}>
                  <input className={`input ${fieldError("needChange.stopComment") ? "input-error" : ""}`} value={stopComment} onChange={(e) => setStopComment(e.target.value)} />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={cancelOpenTasks} onChange={(e) => setCancelOpenTasks(e.target.checked)} /> Отменить открытые задачи по потребности
              </label>
            </>
          ) : null}

          {mode === "success" ? (
            <>
              <p className="text-sm text-slate-600">Цель клиента достигнута — следующее действие не требуется. Сделку можно оформить отдельно.</p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={cancelOpenTasks} onChange={(e) => setCancelOpenTasks(e.target.checked)} /> Отменить открытые задачи по потребности
              </label>
            </>
          ) : null}
        </fieldset>
      ) : (
        <p className="text-sm text-slate-500">Потребность уже не в работе — фиксируется только результат показа.</p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel}>
          Отмена
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Сохранение…" : "Сохранить результат"}
        </button>
      </div>
    </form>
  );
}
