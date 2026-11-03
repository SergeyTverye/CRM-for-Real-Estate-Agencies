"use client";

import { useRouter } from "next/navigation";
import { optionsOf } from "@/shared/codebook";
import { apiCall } from "../api-client";
import { useApiAction } from "../hooks";

const STATUSES = optionsOf("advertisementStatus");

/** Быстрые действия списка рекламы: «Проверено, актуально» и смена статуса (PATCH с версией записи). */
export function AdQuickActions({ adId, updatedAt, status, canCheck }: { adId: string; updatedAt: string; status: string; canCheck: boolean }) {
  const router = useRouter();
  const { pending, error, run } = useApiAction();
  const patch = async (body: Record<string, unknown>) => {
    const res = await run(() => apiCall("PATCH", `/api/v1/advertisements/${adId}`, { ...body, expectedUpdatedAt: updatedAt }));
    if (res !== undefined) router.refresh();
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        {canCheck ? (
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => void patch({ markChecked: true })} title="Подтвердить, что объявление опубликовано и актуально">
            ✓ Проверено
          </button>
        ) : null}
        <select
          aria-label="Статус объявления"
          className="input w-auto py-1 text-xs"
          value={status}
          disabled={pending}
          onChange={(e) => {
            if (e.target.value !== status) void patch({ status: e.target.value });
          }}
        >
          {STATUSES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <span className="max-w-56 text-right text-xs text-red-600">
          {error.message}
          {error.code === "STALE_UPDATE" ? (
            <button type="button" className="btn-link ml-1 text-xs" onClick={() => router.refresh()}>
              Обновить
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
