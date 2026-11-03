"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "../api-client";
import { useApiAction } from "../hooks";
import { Field, FormErrorBanner } from "../form";
import { DateTimeInput, Modal, NextActionFields, SelectInput, defaultNextAction, type NextActionValue, type Option } from "../client-kit";
import { optionsOf } from "@/shared/codebook";
import { NEED_TASK_TYPES } from "./need-state-actions";

/**
 * Быстрая запись коммуникации по потребности (FR-07, ТЗ 40.7): после звонка/встречи можно
 * в той же операции создать задачу, сменить этап, поставить паузу с задачей возврата или закрыть с причиной.
 */

const TYPES = optionsOf("communicationType");
const RESULTS = optionsOf("communicationResult");
const STAGES = optionsOf("needStage");
const STOP_REASONS = optionsOf("stopReason");

type Continuation = "none" | "task" | "stage" | "pause" | "close";

export function NeedCommunicationButton({
  clientId,
  needId,
  needUpdatedAt,
  needStatus,
  needStage,
  timeZone,
  channels,
  users,
  label = "+ Коммуникация",
  buttonClassName = "btn",
}: {
  clientId: string;
  needId: string;
  needUpdatedAt: string;
  needStatus: string;
  needStage: string;
  timeZone: string;
  channels: Option[];
  users?: Option[];
  label?: string;
  buttonClassName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("call");
  const [occurredAt, setOccurredAt] = useState("");
  const [channelCode, setChannel] = useState("");
  const [resultCode, setResult] = useState("completed");
  const [comment, setComment] = useState("");
  const [cont, setCont] = useState<Continuation>("none");
  const [task, setTask] = useState<NextActionValue>(() => defaultNextAction("Следующий шаг"));
  const [stage, setStage] = useState("");
  const [returnTask, setReturnTask] = useState<NextActionValue>(() => defaultNextAction("Вернуться к потребности", 24 * 7));
  const [stopReasonCode, setStopReason] = useState("");
  const [stopComment, setStopComment] = useState("");
  const { pending, error, run, fieldError, setError } = useApiAction();
  const needOpen = needStatus === "active" || needStatus === "paused";

  function reset() {
    setType("call");
    setOccurredAt(new Date().toISOString());
    setChannel("");
    setResult("completed");
    setComment("");
    setCont("none");
    setTask(defaultNextAction("Следующий шаг"));
    setStage("");
    setReturnTask(defaultNextAction("Вернуться к потребности", 24 * 7));
    setStopReason("");
    setStopComment("");
    setError(null);
  }

  async function submit() {
    const change =
      cont === "stage"
        ? { expectedUpdatedAt: needUpdatedAt, stage }
        : cont === "pause"
          ? { expectedUpdatedAt: needUpdatedAt, status: "paused", returnTask }
          : cont === "close"
            ? { expectedUpdatedAt: needUpdatedAt, status: "closed", stopReasonCode: stopReasonCode || null, stopComment: stopComment || null, cancelOpenTasks: true }
            : undefined;
    const body = {
      clientId,
      clientNeedId: needId,
      communicationType: type,
      occurredAt: occurredAt || null,
      channelCode: channelCode || null,
      resultCode: resultCode || null,
      comment: comment || null,
      nextTask: cont === "task" ? task : undefined,
      needChange: change,
    };
    const res = await run(() => apiCall("POST", "/api/v1/communications", body));
    if (res !== undefined) {
      setOpen(false);
      router.refresh();
    }
  }

  const contOptions: { value: Continuation; label: string }[] = [
    { value: "none", label: "Без продолжения" },
    { value: "task", label: "Создать задачу" },
    ...(needOpen
      ? ([
          { value: "stage", label: "Сменить этап" },
          ...(needStatus === "active" ? [{ value: "pause" as const, label: "Поставить на паузу" }] : []),
          { value: "close", label: "Закрыть потребность" },
        ] as { value: Continuation; label: string }[])
      : []),
  ];

  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        {label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Коммуникация по потребности" wide>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <FormErrorBanner error={error} />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Field label="Тип" required error={fieldError("communicationType")}>
              <SelectInput value={type} onChange={setType} options={TYPES} />
            </Field>
            <Field label="Когда" error={fieldError("occurredAt")}>
              <DateTimeInput value={occurredAt} onChange={setOccurredAt} timeZone={timeZone} />
            </Field>
            <Field label="Канал" error={fieldError("channelCode")}>
              <SelectInput value={channelCode} onChange={setChannel} options={channels} placeholder="—" />
            </Field>
            <Field label="Результат" error={fieldError("resultCode")}>
              <SelectInput value={resultCode} onChange={setResult} options={RESULTS} placeholder="—" />
            </Field>
          </div>
          <Field label="Комментарий" error={fieldError("comment")}>
            <textarea className="input min-h-20" value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>

          <fieldset>
            <legend className="label">Что дальше</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {contOptions.map((o) => (
                <label key={o.value} className="flex items-center gap-1.5 text-sm">
                  <input type="radio" name="continuation" checked={cont === o.value} onChange={() => setCont(o.value)} /> {o.label}
                </label>
              ))}
            </div>
            {needStatus === "active" && cont === "none" ? (
              <p className="mt-1 text-xs text-slate-500">Если прежнее следующее действие выполнено — создайте новый шаг, чтобы потребность не осталась без контроля.</p>
            ) : null}
          </fieldset>

          {cont === "task" ? <NextActionFields value={task} onChange={setTask} timeZone={timeZone} taskTypes={NEED_TASK_TYPES} users={users} errors={fieldError} prefix="nextTask" /> : null}
          {cont === "stage" ? (
            <Field label="Новый этап" required error={fieldError("needChange.stage")}>
              <SelectInput value={stage} onChange={setStage} options={STAGES.filter((o) => o.value !== needStage)} placeholder="—" />
            </Field>
          ) : null}
          {cont === "pause" ? (
            <NextActionFields value={returnTask} onChange={setReturnTask} timeZone={timeZone} taskTypes={NEED_TASK_TYPES} users={users} errors={fieldError} prefix="needChange.returnTask" heading="Задача возврата" />
          ) : null}
          {cont === "close" ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Причина остановки" required error={fieldError("needChange.stopReasonCode")}>
                <SelectInput value={stopReasonCode} onChange={setStopReason} options={STOP_REASONS} placeholder="—" />
              </Field>
              <Field label="Комментарий к закрытию" required={stopReasonCode === "other"} error={fieldError("needChange.stopComment")}>
                <input className="input" value={stopComment} onChange={(e) => setStopComment(e.target.value)} />
              </Field>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Отмена
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending || (cont === "stage" && !stage)}>
              {pending ? "Сохранение…" : "Сохранить"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
