"use client";
import { useState } from "react";
import { apiCall } from "@/ui/api-client";
import { useApiAction } from "@/ui/hooks";
import { FormErrorBanner } from "@/ui/form";
export function PlannerSettings({ initial, onSaved }: { initial: { soonThresholdHours: number; updatedAt: string | null }; onSaved: () => void }) {
  const [setting, setSetting] = useState(initial), [hours, setHours] = useState(initial.soonThresholdHours), [notice, setNotice] = useState(""); const action = useApiAction();
  return <details className="mb-3 rounded-md border border-slate-200 bg-white p-3"><summary>Настройка близкого срока</summary><form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); void action.run(async () => { const value = await apiCall<typeof initial>("PUT", "/api/v1/calendar/settings", { soonThresholdHours: hours, expectedUpdatedAt: setting.updatedAt }); setSetting(value); setNotice("Порог сохранён"); onSaved(); return true; }); }}><label>Скоро, часов <input className="input w-24" type="number" min={1} max={8760} value={hours} onChange={e => setHours(Number(e.target.value))} /></label><button className="btn" disabled={action.pending}>Сохранить порог</button><span role="status">{notice}</span></form><FormErrorBanner error={action.error} onRetry={async () => { const next = await apiCall<typeof initial>("GET", "/api/v1/calendar/settings"); setSetting(next); setHours(next.soonThresholdHours); action.setError(null); }} /></details>;
}
