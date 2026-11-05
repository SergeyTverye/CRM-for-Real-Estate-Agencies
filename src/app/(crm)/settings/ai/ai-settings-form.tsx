"use client";
import { labelOf } from "@/shared/codebook";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "@/ui/api-client";
import { FormErrorBanner } from "@/ui/form";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { AI_SOURCES, type AiSettingsInput } from "@/modules/ai/domain/settings";
import type { getAiSettings } from "@/modules/ai/application/settings-service";

type Data = Awaited<ReturnType<typeof getAiSettings>>;
const switches = { aiEnabled: "ИИ", scraperEnabled: "Скрапер", browserEnabled: "Браузерный режим",
  webSearchManualAllowed: "Ручной веб-поиск", webSearchAutoFallback: "Автопереход при полном техническом отказе" } as const;
const numbers = { perUserDailyLimit: "Вызовов на сотрудника в сутки / веб-заданий", perJobLimit: "Вызовов на задание", dailyLimit: "Вызовов агентства в сутки" } as const;
export function AiSettingsForm({ data }: { data: Data }) {
  const router = useRouter();
  const [form, setForm] = useState<AiSettingsInput>(() => ({
    expectedUpdatedAt: data.setting.updatedAt, aiEnabled: data.setting.aiEnabled, scraperEnabled: data.setting.scraperEnabled,
    browserEnabled: data.setting.browserEnabled, enabledSources: data.setting.enabledSources as AiSettingsInput["enabledSources"],
    webSearchManualAllowed: data.setting.webSearchManualAllowed, webSearchAutoFallback: data.setting.webSearchAutoFallback,
    model: data.setting.model, webModel: data.setting.webModel, searchContextSize: data.setting.searchContextSize as AiSettingsInput["searchContextSize"],
    perUserDailyLimit: data.setting.perUserDailyLimit, perJobLimit: data.setting.perJobLimit, dailyLimit: data.setting.dailyLimit, monthlyBudgetRub: data.setting.monthlyBudgetRub,
  }));
  const [dirty, setDirty] = useState(false);
  const [addTariff, setAddTariff] = useState(false);
  const [tariff, setTariff] = useState({ model: form.model, effectiveFrom: "", inputRubPerMillion: "", outputRubPerMillion: "", webRubPerCall: "0.915" });
  const action = useApiAction();
  useUnsavedChangesWarning(dirty);
  function change<K extends keyof AiSettingsInput>(key: K, value: AiSettingsInput[K]) { setForm((v) => ({ ...v, [key]: value })); setDirty(true); }
  const envNote = (key: string) => data.effective.restrictedByEnv.includes(key) ? <span> Ограничено ENV</span> : null;
  return <form onSubmit={async (event) => {
    event.preventDefault();
    const result = await action.run(() => apiCall<Data>("PUT", "/api/v1/settings/ai", { ...form,
      ...(addTariff ? { tariffs: [{ ...tariff, effectiveFrom: new Date(tariff.effectiveFrom).toISOString() }] } : {}) }));
    if (result) { setDirty(false); setAddTariff(false); setForm((v) => ({ ...v, expectedUpdatedAt: result.setting.updatedAt })); router.refresh(); }
  }} className="stack">
    <FormErrorBanner error={action.error} />
    {action.error?.fieldErrors && <ul role="alert">{Object.entries(action.error.fieldErrors).map(([key, errors]) => <li key={key}>{key}: {errors.join("; ")}</li>)}</ul>}
    {action.error?.code === "STALE_UPDATE" && <button type="button" onClick={() => window.location.reload()}>Обновить данные</button>}
    <fieldset disabled={action.pending} className="stack">
      <legend>Режимы и площадки</legend>
      {(Object.keys(switches) as (keyof typeof switches)[]).map((key) => <label key={key}><input type="checkbox" checked={form[key]} onChange={(e) => change(key, e.target.checked)} /> {switches[key]}{envNote(key)}</label>)}
      <div>{AI_SOURCES.map((source) => <label key={source} style={{ marginRight: 16 }}><input type="checkbox" checked={form.enabledSources.includes(source)}
        onChange={(e) => change("enabledSources", e.target.checked ? [...form.enabledSources, source] : form.enabledSources.filter((s) => s !== source))} /> {labelOf("externalSource", source)}</label>)}</div>
      <label>Модель <input required value={form.model} onChange={(e) => change("model", e.target.value)} /></label>
      <label>Модель веб-поиска (пусто — основная) <input value={form.webModel ?? ""} onChange={(e) => change("webModel", e.target.value || null)} /></label>
      <label>Поисковый контекст <select value={form.searchContextSize} onChange={(e) => change("searchContextSize", e.target.value as AiSettingsInput["searchContextSize"])}>
        <option value="low">Малый</option><option value="medium">Средний</option><option value="high">Большой</option></select>{envNote("searchContextSize")}</label>
      {(Object.keys(numbers) as (keyof typeof numbers)[]).map((key) => <label key={key}>{numbers[key]} <input type="number" min="0" max="100000" required value={form[key]} onChange={(e) => change(key, Number(e.target.value))} />{envNote(key)}<small> Действует: {data.effective.values[key]}</small></label>)}
      <label>Общий месячный бюджет, ₽ <input required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value={form.monthlyBudgetRub} onChange={(e) => change("monthlyBudgetRub", e.target.value)} />{envNote("monthlyBudgetRub")}<small> Действует: {data.effective.values.monthlyBudgetRub} ₽</small></label>
      <p>Действует: ИИ {data.effective.values.aiEnabled ? "включён" : "выключен"}; скрапер {data.effective.values.scraperEnabled ? "включён" : "выключен"}; браузер {data.effective.values.browserEnabled ? "включён" : "выключен"}; ручной веб-поиск {data.effective.values.webSearchManualAllowed ? "разрешён" : "запрещён"}; автопереход {data.effective.values.webSearchAutoFallback ? "разрешён" : "запрещён"}.</p>
      <label><input type="checkbox" checked={addTariff} onChange={(e) => { setAddTariff(e.target.checked); setDirty(true); }} /> Добавить версию тарифа</label>
      {addTariff && <div className="stack">
        <label>Модель тарифа <input required value={tariff.model} onChange={(e) => setTariff({ ...tariff, model: e.target.value })} /></label>
        <label>Дата начала действия <input required type="datetime-local" value={tariff.effectiveFrom} onChange={(e) => setTariff({ ...tariff, effectiveFrom: e.target.value })} /></label>
        {([['inputRubPerMillion', '₽ за миллион входных токенов'], ['outputRubPerMillion', '₽ за миллион выходных токенов'], ['webRubPerCall', '₽ за вызов веб-поиска']] as const).map(([key, label]) => <label key={key}>{label} <input required type="number" min="0.000001" step="0.000001" value={tariff[key]} onChange={(e) => setTariff({ ...tariff, [key]: e.target.value })} /></label>)}
      </div>}
      <button type="submit" className="btn btn-primary">{action.pending ? "Сохранение…" : "Сохранить настройки"}</button>
    </fieldset>
  </form>;
}
