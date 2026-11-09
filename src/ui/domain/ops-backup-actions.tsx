"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "../api-client";
import { useApiAction } from "../hooks";
import { FormErrorBanner } from "../form";

const WAIT_FOR_RUN_MS = 45_000;


export function BackupNowButton({ latestRunId, running }: { latestRunId: string | null; running: boolean }) {
  const router = useRouter();
  const { pending, error, run } = useApiAction();
  const [awaiting, setAwaiting] = useState<{ baseline: string | null } | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const appeared = awaiting !== null && latestRunId !== awaiting.baseline;
  const waiting = awaiting !== null && !appeared && !timedOut;

  useEffect(() => {
    if (!waiting) return;
    const poll = setInterval(() => router.refresh(), 3000);
    const stop = setTimeout(() => setTimedOut(true), WAIT_FOR_RUN_MS);
    return () => {
      clearInterval(poll);
      clearTimeout(stop);
    };
  }, [waiting, router]);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending || running || waiting}
        title={running ? "Резервное копирование уже выполняется" : undefined}
        onClick={async () => {
          setTimedOut(false);
          const res = await run(() => apiCall("POST", "/api/v1/operations/backups"));
          if (res !== undefined) {
            setAwaiting({ baseline: latestRunId });
            router.refresh();
          }
        }}
      >
        {pending ? "Запуск…" : running || waiting ? "Backup выполняется…" : "Создать backup сейчас"}
      </button>
      {waiting ? (
        <span className="text-xs text-slate-500" role="status">
          Запуск принят, ожидаем запись в журнале запусков…
        </span>
      ) : null}
      {error ? (
        <div className="max-w-md text-left">
          <FormErrorBanner error={error} />
        </div>
      ) : null}
      {timedOut && !appeared ? (
        <div className="alert alert-warning max-w-md text-left text-xs" role="alert">
          Скрипт резервного копирования не зарегистрировал запуск за {WAIT_FOR_RUN_MS / 1000} с. Вероятно, в этом окружении недоступны PostgreSQL-утилиты (psql, pg_dump) или zstd/flock. Проверьте журнал сервера (событие
          backup.manual_finished) и выполните <code>./scripts/backup.sh</code> на сервере.
        </div>
      ) : null}
    </div>
  );
}

interface VerifyResult {
  backupId: string;
  verified: boolean;
  output: string;
}


export function VerifyBackupButton({ backupId }: { backupId: string }) {
  const { pending, error, run } = useApiAction();
  const [result, setResult] = useState<VerifyResult | null>(null);
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        className="btn btn-sm"
        disabled={pending}
        onClick={async () => {
          setResult(null);
          const res = await run(() => apiCall<VerifyResult>("POST", `/api/v1/operations/backups/${encodeURIComponent(backupId)}/verify`));
          if (res) setResult(res);
        }}
      >
        {pending ? "Проверка…" : "Проверить копию"}
      </button>
      {pending ? <span className="text-xs text-slate-500">Проверка может занять несколько минут</span> : null}
      {error ? <span className="max-w-xs text-xs text-red-700">{error.message}</span> : null}
      {result ? (
        <div className="max-w-md text-xs">
          <span className={`badge ${result.verified ? "badge-green" : "badge-red"}`}>{result.verified ? "✓ Копия проверена" : "✕ Проверка не пройдена"}</span>
          {result.output ? (
            <details className="mt-1">
              <summary className="cursor-pointer text-brand-600">Вывод проверки</summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-[11px] text-slate-700">{result.output}</pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
