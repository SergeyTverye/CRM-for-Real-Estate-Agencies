"use client";
import Link from "next/link";
import { DateTimeInput } from "@/ui/client-kit";
import { toast } from "@/ui/toast";
import { labelOf } from "@/shared/codebook";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "@/ui/api-client";
import { FormErrorBanner } from "@/ui/form";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { AI_SOURCES, type AiSettingsInput } from "@/modules/ai/domain/settings";
import type { getAiSettings } from "@/modules/ai/application/settings-service";

type Data = Awaited<ReturnType<typeof getAiSettings>>;
const contextLabel = (value: string) => ({ low: "Малый", medium: "Средний", high: "Большой" })[value] ?? value;

const scraperSwitches = {
  scraperEnabled: "Скрапер",
  browserEnabled: "Браузерный режим",
} as const;

const aiSwitches = {
  aiEnabled: "ИИ",
  webSearchManualAllowed: "Ручной веб-поиск",
  webSearchAutoFallback: "Автопереход при полном техническом отказе",
} as const;

const numbers = {
  perUserDailyLimit: "AI-вызовов на сотрудника в сутки",
  perJobLimit: "Вызовов на задание",
  dailyLimit: "Вызовов агентства в сутки",
} as const;

export type Ceilings = {
  perUserDailyLimit: number;
  perJobLimit: number;
  dailyLimit: number;
  monthlyBudgetRub: string;
  searchContextSize: string;
} & Record<keyof typeof aiSwitches | keyof typeof scraperSwitches, boolean>;

export function AiSettingsForm({
  data,
  ceilings,
  timeZone,
  mode = "all",
  browserConfigured,
}: {
  data: Data;
  ceilings: Ceilings;
  timeZone: string;
  mode?: "all" | "sources";
  browserConfigured?: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<AiSettingsInput>(() => ({
    expectedUpdatedAt: data.setting.updatedAt,
    aiEnabled: data.setting.aiEnabled,
    scraperEnabled: data.setting.scraperEnabled,
    browserEnabled: data.setting.browserEnabled,
    enabledSources: data.setting.enabledSources as AiSettingsInput["enabledSources"],
    webSearchManualAllowed: data.setting.webSearchManualAllowed,
    webSearchAutoFallback: data.setting.webSearchAutoFallback,
    model: data.setting.model,
    webModel: data.setting.webModel,
    searchContextSize: data.setting.searchContextSize as AiSettingsInput["searchContextSize"],
    perUserDailyLimit: data.setting.perUserDailyLimit,
    perJobLimit: data.setting.perJobLimit,
    dailyLimit: data.setting.dailyLimit,
    monthlyBudgetRub: data.setting.monthlyBudgetRub,
  }));
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [addTariff, setAddTariff] = useState(false);
  const [tariff, setTariff] = useState({
    model: form.model,
    effectiveFrom: "",
    inputRubPerMillion: "",
    outputRubPerMillion: "",
    webRubPerCall: "0.915",
  });
  const action = useApiAction();

  const effectiveModes = {
    ...data.effective.values,
    browserEnabled: data.effective.values.scraperEnabled && data.effective.values.browserEnabled,
    webSearchManualAllowed: data.effective.values.aiEnabled && data.effective.values.webSearchManualAllowed,
    webSearchAutoFallback:
      data.effective.values.aiEnabled &&
      data.effective.values.webSearchManualAllowed &&
      data.effective.values.webSearchAutoFallback,
  };

  useUnsavedChangesWarning(dirty);

  function change<K extends keyof AiSettingsInput>(key: K, value: AiSettingsInput[K]) {
    setForm((v) => ({ ...v, [key]: value }));
    setDirty(true);
    setSaved(false);
  }

  const envNote = (key: string) =>
    data.effective.restrictedByEnv.includes(key) ? <span> Ограничено ENV</span> : null;

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const result = await action.run(() =>
          apiCall<Data>("PUT", "/api/v1/settings/ai", {
            ...form,
            ...(addTariff ? { tariffs: [{ ...tariff, effectiveFrom: tariff.effectiveFrom }] } : {}),
          }),
        );
        if (result) {
          toast(mode === "sources" ? "Настройки источников сохранены" : "Настройки ИИ сохранены");
          setSaved(true);
          setDirty(false);
          setAddTariff(false);
          setForm((v) => ({ ...v, expectedUpdatedAt: result.setting.updatedAt }));
          router.refresh();
        }
      }}
      className="stack"
    >
      <FormErrorBanner error={action.error} />
      {saved && (
        <p className="alert alert-success" role="status">
          Настройки сохранены. Эффективные ограничения обновлены.
        </p>
      )}
      {action.error?.fieldErrors && (
        <ul role="alert">
          {Object.entries(action.error.fieldErrors).map(([key, errors]) => (
            <li key={key}>
              {key}: {errors.join("; ")}
            </li>
          ))}
        </ul>
      )}
      {action.error?.code === "STALE_UPDATE" && (
        <button type="button" onClick={() => window.location.reload()}>
          Обновить данные
        </button>
      )}

      <fieldset disabled={action.pending} className="stack">
        <legend>
          {mode === "sources" ? "Скрапер, браузерный режим и площадки поиска" : "Источники поиска и скрапер (без ИИ)"}
        </legend>
        {mode === "all" && (
          <p className="text-sm text-slate-600">
            Настройки площадок и скрапера работают независимо от Яндекс AI. Доступна также отдельная страница{" "}
            <Link className="link" href="/settings/sources">
              «Источники поиска» (/settings/sources)
            </Link>
            .
          </p>
        )}
        {(Object.keys(scraperSwitches) as (keyof typeof scraperSwitches)[]).map((key) => (
          <label key={key}>
            <input type="checkbox" checked={form[key]} onChange={(e) => change(key, e.target.checked)} />{" "}
            {scraperSwitches[key]}
            {envNote(key)}
            <small>
              Запрошено в настройках: {form[key] ? "включено" : "выключено"} · Действует:{" "}
              {effectiveModes[key] ? "включено" : "выключено"} · ENV:{" "}
              {ceilings[key] ? "разрешено" : "запрещено"}
              {key === "browserEnabled" && browserConfigured !== undefined
                ? ` · Chromium: ${browserConfigured ? "сконфигурирован" : "по умолчанию"}`
                : ""}
              .
            </small>
          </label>
        ))}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>Площадки объявлений ({form.enabledSources.length} из {AI_SOURCES.length})</strong>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => change("enabledSources", [...AI_SOURCES])}
              >
                Включить все площадки
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => change("enabledSources", [])}
              >
                Отключить все
              </button>
            </div>
          </div>
          <div>
            {AI_SOURCES.map((source) => {
              const sourceEffective = effectiveModes.scraperEnabled && form.enabledSources.includes(source);
              return (
                <label key={source} style={{ marginRight: 16 }}>
                  <input
                    type="checkbox"
                    checked={form.enabledSources.includes(source)}
                    onChange={(e) =>
                      change(
                        "enabledSources",
                        e.target.checked
                          ? [...form.enabledSources, source]
                          : form.enabledSources.filter((s) => s !== source),
                      )
                    }
                  />{" "}
                  {labelOf("externalSource", source)}{" "}
                  <small className="text-slate-500">
                    ({sourceEffective ? "активна" : !ceilings.scraperEnabled ? "откл. ENV" : "отключена"})
                  </small>
                </label>
              );
            })}
          </div>
        </div>
        <p className="text-sm text-slate-600">
          Браузерный режим действует при включённом скрапере и используется для интерактивного прохождения проверок
          площадок. Площадки опрашиваются напрямую без расхода бюджета Яндекс AI.
        </p>
      </fieldset>

      {mode === "all" && (
        <fieldset disabled={action.pending} className="stack">
          <legend>Режимы, модели и бюджет Яндекс AI</legend>
          {(Object.keys(aiSwitches) as (keyof typeof aiSwitches)[]).map((key) => (
            <label key={key}>
              <input type="checkbox" checked={form[key]} onChange={(e) => change(key, e.target.checked)} />{" "}
              {aiSwitches[key]}
              {envNote(key)}
              <small>
                Запрошено: {form[key] ? "включено" : "выключено"} · Действует:{" "}
                {effectiveModes[key] ? "включено" : "выключено"} · ENV:{" "}
                {ceilings[key] ? "разрешено" : "запрещено"}.
              </small>
            </label>
          ))}
          <label>
            Модель <input required value={form.model} onChange={(e) => change("model", e.target.value)} />
          </label>
          <label>
            Модель веб-поиска (пусто — основная){" "}
            <input value={form.webModel ?? ""} onChange={(e) => change("webModel", e.target.value || null)} />
          </label>
          <label>
            Поисковый контекст{" "}
            <select
              value={form.searchContextSize}
              onChange={(e) => change("searchContextSize", e.target.value as AiSettingsInput["searchContextSize"])}
            >
              <option value="low">Малый</option>
              <option value="medium">Средний</option>
              <option value="high">Большой</option>
            </select>
            {envNote("searchContextSize")}
            <small>
              Действует: {contextLabel(data.effective.values.searchContextSize)}. ENV-потолок:{" "}
              {contextLabel(ceilings.searchContextSize)}.
            </small>
          </label>
          {(Object.keys(numbers) as (keyof typeof numbers)[]).map((key) => (
            <label key={key}>
              {numbers[key]}{" "}
              <input
                type="number"
                min="0"
                max="100000"
                required
                value={form[key]}
                onChange={(e) => change(key, Number(e.target.value))}
              />
              {envNote(key)}
              <small>
                Сохранено: {data.setting[key]}. Действует: {data.effective.values[key]}. ENV-потолок: {ceilings[key]}.
              </small>
            </label>
          ))}
          <label>
            Общий месячный бюджет, ₽{" "}
            <input
              required
              inputMode="decimal"
              pattern="[0-9]+([.][0-9]{1,2})?"
              value={form.monthlyBudgetRub}
              onChange={(e) => change("monthlyBudgetRub", e.target.value)}
            />
            {envNote("monthlyBudgetRub")}
            <small>
              Действует: {data.effective.values.monthlyBudgetRub} ₽. ENV-потолок: {ceilings.monthlyBudgetRub} ₽.
            </small>
          </label>
          <p>
            Веб-поиск и автопереход недоступны при выключенном ИИ. Браузерный режим действует при включённом скрапере.
            Площадки выше используются только при разрешённом скрапере.
          </p>
          <label>
            <input
              type="checkbox"
              checked={addTariff}
              onChange={(e) => {
                setAddTariff(e.target.checked);
                setDirty(true);
                setSaved(false);
              }}
            />{" "}
            Добавить версию тарифа
          </label>
          {addTariff && (
            <div className="stack">
              <label>
                Модель тарифа{" "}
                <input required value={tariff.model} onChange={(e) => setTariff({ ...tariff, model: e.target.value })} />
              </label>
              <label>
                Дата начала действия{" "}
                <DateTimeInput
                  value={tariff.effectiveFrom}
                  timeZone={timeZone}
                  onChange={(value) => {
                    setTariff({ ...tariff, effectiveFrom: value });
                    setDirty(true);
                  }}
                />
              </label>
              {(
                [
                  ["inputRubPerMillion", "₽ за миллион входных токенов"],
                  ["outputRubPerMillion", "₽ за миллион выходных токенов"],
                  ["webRubPerCall", "₽ за вызов веб-поиска"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}{" "}
                  <input
                    required
                    type="number"
                    min="0.000001"
                    step="0.000001"
                    value={tariff[key]}
                    onChange={(e) => setTariff({ ...tariff, [key]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          )}
          <p>
            Ноль запрещает новые вызовы. Изменения действуют после сохранения. Значение выше ENV не увеличивает лимит;
            ENV меняет администратор установки. Суточные ENV-потолки выведены из часового лимита × 8; общий предел на
            задание — 10 вызовов. Для веб-поиска дополнительно действуют отдельные ENV-лимиты.
          </p>
        </fieldset>
      )}

      <div className="ai-save-actions">
        <button type="submit" className="btn btn-primary" disabled={action.pending}>
          {action.pending
            ? "Сохранение…"
            : mode === "sources"
              ? "Сохранить настройки источников"
              : "Сохранить настройки"}
        </button>
      </div>
    </form>
  );
}
