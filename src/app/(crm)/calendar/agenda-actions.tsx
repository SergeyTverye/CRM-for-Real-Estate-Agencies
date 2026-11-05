"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { type CalendarItem } from "@/modules/calendar/domain/calendar-rules";
import { apiCall } from "@/ui/api-client";
import { DateTimeInput } from "@/ui/client-kit";
import { FormErrorBanner } from "@/ui/form";
import { useApiAction } from "@/ui/hooks";
export function AgendaActions({ item, timeZone }: { item: CalendarItem; timeZone: string }) {
  const [at,setAt] = useState<string | null>(null), action = useApiAction(), router = useRouter();
  if (!item.editable || item.recurrenceRule) return null;
  async function mutate(url: string, body: unknown) {
    if (await action.run(() => apiCall("POST",url,body))) { setAt(null); router.refresh(); }
  }
  return <span className="ml-auto flex flex-wrap items-center gap-2">
    {item.type === "task" && <button className="btn btn-sm" disabled={action.pending} onClick={() => void mutate(`/api/v1/tasks/${item.sourceId}/complete`,{ expectedUpdatedAt: item.updatedAt })}>Выполнить</button>}
    <button className="btn btn-sm" onClick={() => setAt(item.start)}>Перенести</button>
    {at && <><DateTimeInput timeZone={timeZone} value={at} onChange={setAt} /><button className="btn btn-sm" disabled={action.pending} onClick={() => void mutate("/api/v1/calendar/move",{ type: item.type, id: item.sourceId, startAt: at, expectedUpdatedAt: item.updatedAt })}>Сохранить</button><button className="btn btn-sm" onClick={() => setAt(null)}>Отмена</button></>}
    <FormErrorBanner error={action.error} onRetry={() => router.refresh()} />
  </span>;
}
