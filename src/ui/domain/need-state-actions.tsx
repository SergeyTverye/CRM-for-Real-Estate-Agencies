"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "../api-client";
import { useApiAction } from "../hooks";
import { Field, FormErrorBanner } from "../form";
import { Modal, NextActionFields, SelectInput, defaultNextAction, type NextActionValue, type Option } from "../client-kit";
import { optionsOf } from "@/shared/codebook";

/**
 * Команды жизненного цикла потребности (ТЗ 25.1, 40.2.1): смена этапа, пауза с задачей возврата,
 * закрытие с причиной, успешное завершение, возобновление со следующим действием.
 * Все переходы — POST /api/v1/needs/[id]/state с версией записи.
 */

export const NEED_TASK_TYPES = optionsOf("taskType").filter((o) => o.value !== "postdeal");
const STAGES = optionsOf("needStage");
const STOP_REASONS = optionsOf("stopReason");

type Mode = null | "stage" | "pause" | "close" | "success" | "resume";

const TITLES: Record<Exclude<Mode, null>, string> = {
  stage: "Смена этапа",
  pause: "Пауза потребности",
  close: "Закрытие потребности",
  success: "Успешное завершение",
  resume: "Возобновление работы",
};

export function NeedStateActions({
  needId,
  updatedAt,
  status,
  stage,
  timeZone,
  users,
}: {
  needId: string;
  updatedAt: string;
  status: string;
  stage: string;
  timeZone: string;
  users?: Option[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [toStage, setToStage] = useState("");
  const [comment, setComment] = useState("");
  const [stopReasonCode, setStopReason] = useState("");
  const [stopComment, setStopComment] = useState("");
  const [cancelOpenTasks, setCancelOpenTasks] = useState(true);
  const [withNext, setWithNext] = useState(false);
  const [next, setNext] = useState<NextActionValue>(() => defaultNextAction("Связаться с клиентом"));
  const [returnTask, setReturnTask] = useState<NextActionValue>(() => defaultNextAction("Вернуться к потребности", 24 * 7));
  const { pending, error, run, fieldError, setError } = useApiAction();

  const open = (m: Exclude<Mode, null>) => {
    setError(null);
    setComment("");
    setStopReason("");
    setStopComment("");
    setCancelOpenTasks(true);
    setToStage(m === "success" ? (stage === "postdeal" ? "postdeal" : "deal") : "");
    // При возобновлении из closed/success следующее действие обязательно (инвариант active).
    setWithNext(m === "resume");
    setNext(defaultNextAction(m === "resume" ? "Связаться с клиентом" : "Следующий шаг"));
    setReturnTask(defaultNextAction("Вернуться к потребности", 24 * 7));
    setMode(m);
  };

  const needsNextError = error?.code === "NEXT_ACTION_REQUIRED";
  const showNext = withNext || needsNextError;

  async function submit() {
    const base = { expectedUpdatedAt: updatedAt, comment: comment || null };
    let body: Record<string, unknown>;
    switch (mode) {
      case "stage":
        body = { ...base, stage: toStage || undefined, nextAction: showNext ? next : undefined };
        break;
      case "pause":
        body = { ...base, status: "paused", returnTask };
        break;
      case "close":
        body = { ...base, comment: undefined, status: "closed", stopReasonCode: stopReasonCode || null, stopComment: stopComment || null, cancelOpenTasks };
        break;
      case "success":
        body = { ...base, status: "success", stage: toStage && toStage !== stage ? toStage : undefined, cancelOpenTasks };
        break;
      case "resume":
        body = { ...base, status: "active", nextAction: showNext ? next : undefined };
        break;
      default:
        return;
    }
    const res = await run(() => apiCall("POST", `/api/v1/needs/${needId}/state`, body));
    if (res !== undefined) {
      setMode(null);
      router.refresh();
    }
  }

  const isOpen = status === "active" || status === "paused";
  const btn = (m: Exclude<Mode, null>, label: string, cls = "btn btn-sm") => (
    <button type="button" className={cls} onClick={() => open(m)}>
      {label}
    </button>
  );

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {isOpen ? btn("stage", "Сменить этап") : null}
        {status === "active" ? btn("pause", "Пауза") : null}
        {status === "paused" ? btn("resume", "Возобновить", "btn btn-sm btn-primary") : null}
        {isOpen ? btn("success", "Успешно завершена") : null}
        {isOpen ? btn("close", "Закрыть", "btn btn-sm btn-danger") : null}
        {!isOpen ? btn("resume", "Возобновить", "btn btn-sm btn-primary") : null}
      </div>
      <Modal open={mode !== null} onClose={() => setMode(null)} title={mode ? TITLES[mode] : ""} wide={mode === "pause" || mode === "resume" || (mode === "stage" && showNext)}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {needsNextError ? <div className="alert alert-warning">{error?.message} Задайте следующее действие ниже.</div> : <FormErrorBanner error={error} />}

          {mode === "stage" ? (
            <>
              <Field label="Новый этап" required error={fieldError("stage")}>
                <SelectInput value={toStage} onChange={setToStage} options={STAGES.filter((o) => o.value !== stage)} placeholder="—" />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={showNext} onChange={(e) => setWithNext(e.target.checked)} /> Добавить следующее действие
              </label>
              {showNext ? <NextActionFields value={next} onChange={setNext} timeZone={timeZone} taskTypes={NEED_TASK_TYPES} users={users} errors={fieldError} /> : null}
            </>
          ) : null}

          {mode === "pause" ? (
            <>
              <p className="text-sm text-slate-600">Пауза — осознанный перерыв в работе. Назначьте задачу возврата с датой, чтобы потребность не потерялась.</p>
              <NextActionFields value={returnTask} onChange={setReturnTask} timeZone={timeZone} taskTypes={NEED_TASK_TYPES} users={users} errors={fieldError} prefix="returnTask" heading="Задача возврата" />
              {fieldError("returnTask") ? <p className="field-error">{fieldError("returnTask")}</p> : null}
            </>
          ) : null}

          {mode === "close" ? (
            <>
              <Field label="Причина остановки" required error={fieldError("stopReasonCode")}>
                <SelectInput value={stopReasonCode} onChange={setStopReason} options={STOP_REASONS} placeholder="—" invalid={Boolean(fieldError("stopReasonCode"))} />
              </Field>
              <Field label="Комментарий" required={stopReasonCode === "other"} error={fieldError("stopComment")}>
                <textarea className={`input min-h-20 ${fieldError("stopComment") ? "input-error" : ""}`} value={stopComment} onChange={(e) => setStopComment(e.target.value)} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={cancelOpenTasks} onChange={(e) => setCancelOpenTasks(e.target.checked)} /> Отменить открытые задачи по потребности
              </label>
            </>
          ) : null}

          {mode === "success" ? (
            <>
              <p className="text-sm text-slate-600">Потребность клиента достигнута (сделка, подписанный договор и т. п.). Следующее действие не требуется.</p>
              <Field label="Итоговый этап">
                <SelectInput value={toStage} onChange={setToStage} options={STAGES} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={cancelOpenTasks} onChange={(e) => setCancelOpenTasks(e.target.checked)} /> Отменить открытые задачи по потребности
              </label>
            </>
          ) : null}

          {mode === "resume" ? (
            <>
              {status === "paused" ? (
                <>
                  <p className="text-sm text-slate-600">Задача возврата останется открытой; при необходимости добавьте новое следующее действие.</p>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={showNext} onChange={(e) => setWithNext(e.target.checked)} /> Добавить следующее действие
                  </label>
                </>
              ) : (
                <p className="text-sm text-slate-600">Потребность снова будет в работе — назначьте следующее действие.</p>
              )}
              {showNext ? <NextActionFields value={next} onChange={setNext} timeZone={timeZone} taskTypes={NEED_TASK_TYPES} users={users} errors={fieldError} /> : null}
            </>
          ) : null}

          {mode !== "close" ? (
            <Field label="Комментарий к решению" error={fieldError("comment")}>
              <textarea className="input min-h-16" value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn" onClick={() => setMode(null)}>
              Отмена
            </button>
            <button type="submit" className={`btn ${mode === "close" ? "btn-danger" : "btn-primary"}`} disabled={pending || (mode === "stage" && !toStage)}>
              {pending ? "Сохранение…" : mode === "close" ? "Закрыть потребность" : "Сохранить"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
