"use client";

import { useRouter } from "next/navigation";
import type { ApiErrorBody } from "./api-client";

export function Field({
  label,
  error,
  children,
  hint,
  required,
  className,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  hint?: string;
  required?: boolean;
  className?: string;
}) {
  
  return (
    <div className={className} data-invalid={error ? "true" : undefined}>
      <label className="block">
        <span className="label">
          {label}
          {required ? <span className="text-red-600"> *</span> : null}
        </span>
        {children}
      </label>
      {hint && !error ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </div>
  );
}


export function FormErrorBanner({ error, onRetry }: { error: ApiErrorBody | null; onRetry?: () => void }) {
  const router = useRouter();
  if (!error) return null;
  if (error.code === "STALE_UPDATE") {
    return (
      <div className="alert alert-warning flex items-center justify-between gap-3" role="alert">
        <span>{error.message}</span>
        <button type="button" className="btn btn-sm" onClick={() => (onRetry ? onRetry() : router.refresh())}>
          Обновить данные
        </button>
      </div>
    );
  }
  const hasFields = error.fieldErrors && Object.keys(error.fieldErrors).length > 0;
  const generic = error.fieldErrors?._?.join("; ");
  return (
    <div className="alert alert-error" role="alert">
      {error.message}
      {generic ? <div className="mt-1">{generic}</div> : null}
      {hasFields && !generic ? <div className="mt-1 text-xs">Исправьте отмеченные поля.</div> : null}
      {error.correlationId && error.code === "INTERNAL_ERROR" ? (
        <div className="mt-1 text-xs opacity-75">Код запроса: {error.correlationId}</div>
      ) : null}
    </div>
  );
}

export function SubmitButton({ pending, children, className }: { pending: boolean; children: React.ReactNode; className?: string }) {
  return (
    <button type="submit" className={`btn btn-primary ${className ?? ""}`} disabled={pending} aria-busy={pending}>
      {pending ? "Сохранение…" : children}
    </button>
  );
}
