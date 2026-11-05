"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { type CalendarItem } from "@/modules/calendar/domain/calendar-rules";
import { apiCall } from "@/ui/api-client";
import { DateTimeInput } from "@/ui/client-kit";
import { FormErrorBanner } from "@/ui/form";
import { useApiAction } from "@/ui/hooks";
import { TaskQuickActions } from "@/ui/domain/task-actions";
export function AgendaActions({ item, timeZone }: { item: CalendarItem; timeZone: string }) {
  const [at,setAt] = useState<string | null>(null), action = useApiAction(), router = useRouter();
  const [warning, setWarning] = useState<string | null>(null);
  if (!item.editable || item.recurrenceRule) return null;
  if (item.type === "task" && item.sourceId && item.updatedAt) return <TaskQuickActions taskId={item.sourceId} updatedAt={item.updatedAt} dueAt={item.start} timeZone={timeZone} />;
  async function mutate(url: string, body: unknown) {
    const result = await action.run(() => apiCall<{ warning?: string }>("POST",url,body));
    if (result) { setWarning(result.warning ?? null); setAt(null); router.refresh(); }
  }
  return <span className="ml-auto flex flex-wrap items-center gap-2">
    {item.type === "task" && <button className="btn btn-sm" disabled={action.pending} onClick={() => void mutate(`/api/v1/tasks/${item.sourceId}/complete`,{ expectedUpdatedAt: item.updatedAt })}>Выполнить</button>}
    <button className="btn btn-sm" onClick={() => setAt(item.start)}>Перенести</button>
    {at && <><DateTimeInput timeZone={timeZone} value={at} onChange={setAt} /><button className="btn btn-sm" disabled={action.pending} onClick={() => void mutate("/api/v1/calendar/move",{ type: item.type, id: item.sourceId, startAt: at, expectedUpdatedAt: item.updatedAt })}>Сохранить</button><button className="btn btn-sm" onClick={() => setAt(null)}>Отмена</button></>}
    <FormErrorBanner error={action.error} onRetry={() => router.refresh()} />
    {warning ? <span className="alert alert-warning text-sm" role="status">{warning}</span> : null}
  </span>;
}
