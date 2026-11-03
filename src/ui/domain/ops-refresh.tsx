"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Периодическое обновление серверной страницы, пока идёт долгая операция (backup, импорт). */
export function AutoRefresh({ active, intervalMs = 4000, label }: { active: boolean; intervalMs?: number; label?: string }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500" role="status">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand-500" aria-hidden />
      {label ?? `Выполняется — страница обновляется каждые ${Math.round(intervalMs / 1000)} с`}
    </span>
  );
}

/** Ручное обновление данных страницы без перезагрузки. */
export function RefreshButton({ label = "Обновить", className }: { label?: string; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className={className ?? "btn"} disabled={pending} onClick={() => start(() => router.refresh())}>
      {pending ? "Обновление…" : label}
    </button>
  );
}
