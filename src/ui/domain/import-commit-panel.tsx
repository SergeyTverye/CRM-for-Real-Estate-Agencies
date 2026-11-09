"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "../api-client";
import { useApiAction } from "../hooks";
import { FormErrorBanner } from "../form";
import { Modal, SelectInput, type Option } from "../client-kit";
import { labelOf } from "@/shared/codebook";

export interface CommitSectionInfo {
  key: string;
  title: string;
  profileCode: string | null;
  location: string;
  recognized: boolean;
  committed: boolean;
  total: number;
  
  candidates: number;
  
  skipped: number;
  duplicates: number;
}

interface CommitResult {
  id: string;
  status: string;
  rowsRead: number;
  rowsImported: number;
  rowsSkipped: number;
  rowsError: number;
}

const isIncoming = (s: CommitSectionInfo) => (s.profileCode ?? "").startsWith("incoming_clients");
const isAgreementControl = (s: CommitSectionInfo) => (s.profileCode ?? "").startsWith("property_agreement_control");


export function ImportCommitPanel({ jobId, jobStatus, sections, users }: { jobId: string; jobStatus: string; sections: CommitSectionInfo[]; users: Option[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [coordinatesAsPhone, setCoordinatesAsPhone] = useState(false);
  const [createTasksFromFixNotes, setCreateTasksFromFixNotes] = useState(false);
  const [responsible, setResponsible] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);
  const { pending, error, run, setError } = useApiAction();

  const available = sections.filter((s) => s.recognized && !s.committed);
  const chosen = available.filter((s) => selected.includes(s.key));
  const incomingChosen = chosen.some(isIncoming);
  const agreementChosen = chosen.some(isAgreementControl);
  const canCommit = jobStatus === "dry_run_ready";
  const toggle = (key: string, on: boolean) => setSelected((cur) => (on ? [...new Set([...cur, key])] : cur.filter((k) => k !== key)));
  const responsibleLabel = responsible ? (users.find((u) => u.value === responsible)?.label ?? "выбранный сотрудник") : "вы (по умолчанию)";

  const submit = async () => {
    const res = await run(() =>
      apiCall<CommitResult>("POST", `/api/v1/import/jobs/${jobId}/commit`, {
        sections: chosen.map((s) => s.key),
        options: {
          coordinatesAsPhone: incomingChosen && coordinatesAsPhone,
          createTasksFromFixNotes: agreementChosen && createTasksFromFixNotes,
          ...(responsible ? { defaultResponsibleUserId: responsible } : {}),
        },
      }),
    );
    if (res) {
      setConfirmOpen(false);
      setResult(res);
      setSelected([]);
      router.refresh();
    }
  };

  const resultBlock = result ? (
    <div className={`alert ${result.rowsError > 0 ? "alert-warning" : "alert-success"} mb-3`} role="status">
      <div className="font-medium">
        Загрузка выполнена: прочитано {result.rowsRead} = загружено {result.rowsImported} + пропущено {result.rowsSkipped} + ошибок {result.rowsError}
        {result.rowsRead === result.rowsImported + result.rowsSkipped + result.rowsError ? " ✓" : " — контрольное равенство не выполнено, проверьте строки"}
      </div>
      <div className="mt-0.5 text-xs">
        Статус задания: {labelOf("importJobStatus", result.status)}. Пропущенные и ошибочные строки — в таблице выше (фильтр «Результат загрузки»).
      </div>
    </div>
  ) : null;

  if (!canCommit) {
    const reason: Record<string, string> = {
      uploaded: "Файл загружен, проверка ещё не выполнена.",
      parsing: "Идёт проверка файла (dry-run). Загрузка станет доступна после её завершения.",
      dry_run_failed: "Проверка не удалась: в файле не найдено ни одной распознанной секции. Загрузите исправленный файл.",
      committing: "Загрузка выполняется. Дождитесь завершения — повторный запуск заблокирован.",
      completed: "Все распознанные секции загружены.",
      completed_with_errors: "Все распознанные секции загружены, часть строк — с ошибками (см. фильтр «Результат загрузки: Ошибка»).",
      failed: "Загрузка прервана: исходный файл недоступен или изменён. Загрузите файл заново.",
      cancelled: "Задание отменено. Незагруженные секции не будут загружены.",
    };
    return (
      <div>
        {resultBlock}
        <div className={`alert ${["failed", "dry_run_failed"].includes(jobStatus) ? "alert-error" : "alert-info"}`}>{reason[jobStatus] ?? "Загрузка недоступна в текущем состоянии задания."}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {resultBlock}
      {!confirmOpen ? <FormErrorBanner error={error} /> : null}

      <fieldset>
        <legend className="mb-2 flex w-full flex-wrap items-center justify-between gap-2 text-sm font-medium text-slate-700">
          <span>Секции для загрузки</span>
          <span className="flex gap-1">
            <button type="button" className="btn btn-sm btn-link" disabled={pending || available.length === 0} onClick={() => setSelected(available.map((s) => s.key))}>
              Выбрать все доступные
            </button>
            <button type="button" className="btn btn-sm btn-link" disabled={pending || selected.length === 0} onClick={() => setSelected([])}>
              Снять выбор
            </button>
          </span>
        </legend>
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {sections.map((s) => {
            const disabled = !s.recognized || s.committed || pending;
            return (
              <li key={s.key} className={`flex items-start gap-3 px-3 py-2 ${!s.recognized || s.committed ? "bg-slate-50" : ""}`}>
                <input
                  id={`sec-${s.key}`}
                  type="checkbox"
                  className="mt-1"
                  checked={selected.includes(s.key) && s.recognized && !s.committed}
                  disabled={disabled}
                  onChange={(e) => toggle(s.key, e.target.checked)}
                />
                <label htmlFor={`sec-${s.key}`} className={`min-w-0 flex-1 ${disabled ? "text-slate-500" : "cursor-pointer"}`}>
                  <span className="font-medium text-slate-800">{s.title}</span>
                  <span className="ml-2 text-xs text-slate-500">{s.location}</span>
                  {s.committed ? <span className="badge badge-green ml-2">Загружена</span> : null}
                  {!s.recognized ? (
                    <span className="mt-0.5 block text-xs text-slate-600">Не распознана — автоматически не импортируется. Нужна новая версия профиля (mapping) в import-profiles/.</span>
                  ) : s.committed ? (
                    <span className="mt-0.5 block text-xs text-slate-500">Секция уже загружена; повторная загрузка не выполняется. Результат по строкам — в таблице выше (фильтр «Результат загрузки»).</span>
                  ) : (
                    <span className="mt-0.5 block text-xs text-slate-500">
                      строк: {s.total} · к загрузке: {s.candidates} · будет пропущено (ошибки, не распознано, политика): {s.skipped}
                      {s.duplicates ? ` · вероятных дублей: ${s.duplicates}` : ""}
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 p-3 md:grid-cols-2">
        <legend className="px-1 text-xs font-semibold text-slate-600">Параметры загрузки</legend>
        <div>
          <label className={`flex items-start gap-2 text-sm ${incomingChosen ? "" : "text-slate-400"}`}>
            <input type="checkbox" className="mt-1" checked={coordinatesAsPhone} disabled={!incomingChosen || pending} onChange={(e) => setCoordinatesAsPhone(e.target.checked)} />
            <span>
              Считать «Координаты» телефоном/e-mail
              <span className="block text-xs text-slate-500">
                Для секции входящих звонков: распознанный телефон или e-mail станет контактом клиента. Иначе значение сохранится только как исходный контакт обращения.
              </span>
            </span>
          </label>
        </div>
        <div>
          <label className={`flex items-start gap-2 text-sm ${agreementChosen ? "" : "text-slate-400"}`}>
            <input type="checkbox" className="mt-1" checked={createTasksFromFixNotes} disabled={!agreementChosen || pending} onChange={(e) => setCreateTasksFromFixNotes(e.target.checked)} />
            <span>
              Создать задачи из «Что нужно исправить»
              <span className="block text-xs text-slate-500">Для секции анализа договоров: по каждой заметке будет создана задача проверки договора. Иначе текст сохранится в договоре как требуемое действие.</span>
            </span>
          </label>
        </div>
        <label className="block md:col-span-2">
          <span className="label">Ответственный за создаваемых клиентов, объекты и задачи</span>
          <SelectInput value={responsible} onChange={setResponsible} options={users} placeholder="Я (по умолчанию)" disabled={pending} />
        </label>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending || chosen.length === 0}
          onClick={() => {
            setError(null);
            setConfirmOpen(true);
          }}
        >
          {pending ? "Загрузка…" : `Загрузить выбранные секции${chosen.length ? ` (${chosen.length})` : ""}`}
        </button>
        {chosen.length === 0 ? <span className="text-xs text-slate-500">Отметьте хотя бы одну распознанную секцию.</span> : null}
      </div>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Подтверждение загрузки в CRM">
        <div className="space-y-3 text-sm">
          <FormErrorBanner error={error} />
          <p>Будут загружены секции:</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {chosen.map((s) => (
              <li key={s.key}>
                {s.title} <span className="text-xs text-slate-500">— к загрузке до {s.candidates} строк, пропуск {s.skipped}</span>
              </li>
            ))}
          </ul>
          <ul className="space-y-0.5 text-xs text-slate-600">
            {incomingChosen ? <li>«Координаты» как телефон/e-mail: {coordinatesAsPhone ? "да" : "нет"}</li> : null}
            {agreementChosen ? <li>Задачи из «Что нужно исправить»: {createTasksFromFixNotes ? "создать" : "не создавать"}</li> : null}
            <li>Ответственный: {responsibleLabel}</li>
          </ul>
          <div className="alert alert-warning text-xs">
            Загрузка изменит данные CRM. Вероятные дубли клиентов и объектов пропускаются, строки с ошибками не загружаются. Повторная загрузка тех же строк файла блокируется ключом исходной записи.
          </div>
          {pending ? (
            <p className="text-slate-600" role="status">
              Выполняется загрузка — не закрывайте страницу…
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn" disabled={pending} onClick={() => setConfirmOpen(false)}>
              Отмена
            </button>
            <button type="button" className="btn btn-primary" disabled={pending} onClick={() => void submit()}>
              {pending ? "Загрузка…" : "Подтвердить загрузку"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
