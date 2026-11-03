"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "../api-client";
import { useApiAction } from "../hooks";
import { FormErrorBanner } from "../form";

/**
 * Шаг 1 мастера импорта (ТЗ 37.14): выбор .xlsx и загрузка. Сервер сразу выполняет dry-run
 * (операционные таблицы не меняются) и возвращает id задания — открываем его карточку.
 */
export function ImportUploadForm({ maxMb, blockedReason }: { maxMb: number; blockedReason?: string | null }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [navigating, setNavigating] = useState(false);
  const { pending, error, run, fieldError, setError } = useApiAction();
  const busy = pending || navigating;

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const file = fileRef.current?.files?.[0];
        if (!file) {
          setError({ code: "VALIDATION_ERROR", message: "Выберите файл", fieldErrors: { file: ["Файл не выбран"] } });
          return;
        }
        if (!/\.xlsx$/i.test(file.name)) {
          setError({ code: "VALIDATION_ERROR", message: "Поддерживается только формат Excel .xlsx", fieldErrors: { file: ["Ожидается файл .xlsx"] } });
          return;
        }
        if (file.size > maxMb * 1024 * 1024) {
          setError({ code: "VALIDATION_ERROR", message: `Файл больше ${maxMb} МБ`, fieldErrors: { file: [`Не более ${maxMb} МБ`] } });
          return;
        }
        const fd = new FormData();
        fd.set("file", file);
        const res = await run(() => apiCall<{ id: string }>("POST", "/api/v1/import/jobs", fd));
        if (res?.id) {
          setNavigating(true);
          router.push(`/import/${res.id}`);
        }
      }}
    >
      <FormErrorBanner error={error} />
      {blockedReason ? <div className="alert alert-warning">{blockedReason}</div> : null}
      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-72 flex-1">
          <span className="label">Файл Excel (.xlsx, не более {maxMb} МБ)</span>
          <input
            ref={fileRef}
            name="file"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className={`block w-full rounded-md border bg-white px-2 py-1.5 text-sm ${fieldError("file") ? "border-red-500" : "border-slate-300"}`}
            disabled={busy || Boolean(blockedReason)}
            onChange={(e) => {
              setError(null);
              setFileName(e.target.files?.[0]?.name ?? null);
            }}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy || Boolean(blockedReason) || !fileName}>
          {pending ? "Загрузка и проверка…" : navigating ? "Открываем результат…" : "Загрузить файл"}
        </button>
      </div>
      {fieldError("file") ? <p className="field-error">{fieldError("file")}</p> : null}
      {pending ? (
        <p className="text-sm text-slate-600" role="status">
          Файл <b>{fileName}</b> загружается, затем выполняется проверка (dry-run): поиск листов и секций, проверка строк и поиск дублей. Это может занять до минуты — не закрывайте страницу.
        </p>
      ) : null}
    </form>
  );
}
