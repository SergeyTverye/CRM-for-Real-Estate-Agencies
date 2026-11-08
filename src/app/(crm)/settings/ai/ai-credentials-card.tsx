"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "@/ui/api-client";
import { FormErrorBanner } from "@/ui/form";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { Badge } from "@/ui/components";
import { toast } from "@/ui/toast";

export interface AiCredentialStatusDto {
  configured: boolean;
  source: "environment" | "local" | "none";
  editable: boolean;
  status: "configured" | "missing" | "unavailable";
}

export function describeCredentialStatus(
  state: AiCredentialStatusDto,
  aiEnabledInSettings: boolean,
): {
  headline: string;
  sourceLabel: string;
  detail: string;
  tone: "green" | "yellow" | "gray";
} {
  if (state.status === "unavailable") {
    return {
      headline: "Защищённое хранилище Яндекс AI недоступно",
      sourceLabel: "Недоступно",
      detail:
        "Локальное защищённое хранилище учётных данных недоступно. Проверьте права пользователя ОС или задайте ключи через переменные окружения сервера.",
      tone: "yellow",
    };
  }
  if (state.status === "configured" || state.configured) {
    const sourceLabel =
      state.source === "environment"
        ? "Переменные окружения сервера (ENV)"
        : state.source === "local"
          ? "Локальное защищённое хранилище (DPAPI)"
          : "Подключено";
    return {
      headline: "Яндекс AI подключён",
      sourceLabel,
      detail:
        state.source === "environment"
          ? "Используются серверные переменные YANDEX_CLOUD_API_KEY и YANDEX_CLOUD_FOLDER (имеют приоритет над локальным хранилищем)."
          : "Учётные данные сохранены в защищённом хранилище текущего профиля. Значения ключа и каталога никогда не возвращаются в браузер.",
      tone: "green",
    };
  }
  if (aiEnabledInSettings) {
    return {
      headline: "Требуется подключение Яндекс AI",
      sourceLabel: "Ключ не задан",
      detail:
        "Режим ИИ включён в настройках, но ключ API и каталог Яндекс Cloud не подключены. Скрапер и поиск по площадкам работают без ИИ.",
      tone: "yellow",
    };
  }
  return {
    headline: "Ключ Яндекс AI не подключён",
    sourceLabel: "Не задано",
    detail: "Для использования разбора запросов, анализа описаний и веб-резерва подключите ключ API и каталог Яндекс Cloud.",
    tone: "gray",
  };
}

export function AiCredentialsCard({
  initialStatus,
  aiEnabled,
}: {
  initialStatus: AiCredentialStatusDto;
  aiEnabled: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<AiCredentialStatusDto>(initialStatus);
  const [apiKey, setApiKey] = useState("");
  const [folder, setFolder] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const action = useApiAction();

  useUnsavedChangesWarning(Boolean(apiKey.trim() || folder.trim()));

  const presentation = describeCredentialStatus(status, aiEnabled);

  async function saveCredentials(event: React.FormEvent) {
    event.preventDefault();
    setFeedback(null);
    const next = await action.run(() =>
      apiCall<AiCredentialStatusDto>("PUT", "/api/v1/settings/ai/credentials", {
        apiKey: apiKey.trim(),
        folder: folder.trim(),
      }),
    );
    if (next) {
      setApiKey("");
      setFolder("");
      setStatus(next);
      setFeedback("Подключение Яндекс AI сохранено в защищённом хранилище.");
      toast("Подключение Яндекс AI обновлено");
      router.refresh();
    }
  }

  async function removeCredentials() {
    setFeedback(null);
    const next = await action.run(() => apiCall<AiCredentialStatusDto>("DELETE", "/api/v1/settings/ai/credentials"));
    if (next) {
      setApiKey("");
      setFolder("");
      setStatus(next);
      setFeedback("Локальные учётные данные Яндекс AI удалены.");
      toast("Локальное подключение Яндекс AI удалено");
      router.refresh();
    }
  }

  return (
    <section className="card card-body space-y-3" aria-label="Подключение Яндекс AI">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2>Подключение Яндекс AI (ключ API и каталог)</h2>
        <Badge tone={presentation.tone}>{presentation.headline}</Badge>
      </div>
      <p className="text-sm text-slate-600">{presentation.detail}</p>
      <dl className="dl">
        <dt>Состояние подключения</dt>
        <dd>{presentation.headline}</dd>
        <dt>Источник ключей</dt>
        <dd>{presentation.sourceLabel}</dd>
        <dt>Запись через интерфейс</dt>
        <dd>{status.editable ? "Доступна (write-only, без отображения сохранённого ключа)" : "Управляется окружением сервера (ENV)"}</dd>
      </dl>

      <FormErrorBanner error={action.error} />
      {feedback && (
        <p className="alert alert-success" role="status">
          {feedback}
        </p>
      )}

      {status.editable ? (
        <form onSubmit={saveCredentials} className="stack" autoComplete="off">
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              Ключ API Яндекс AI (запись без чтения)
              <input
                type="password"
                required
                autoComplete="new-password"
                placeholder={status.configured ? "Введите новый ключ для замены…" : "AQVN..."}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setFeedback(null);
                }}
              />
            </label>
            <label>
              Каталог Яндекс Cloud (Folder ID)
              <input
                type="text"
                required
                autoComplete="off"
                placeholder="b1g..."
                value={folder}
                onChange={(e) => {
                  setFolder(e.target.value);
                  setFeedback(null);
                }}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={action.pending || !apiKey.trim() || !folder.trim()}
            >
              {action.pending ? "Сохранение…" : status.configured ? "Заменить подключение Яндекс AI" : "Подключить Яндекс AI"}
            </button>
            {status.configured && status.source === "local" && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={action.pending}
                onClick={() => void removeCredentials()}
              >
                Удалить локальные ключи
              </button>
            )}
          </div>
        </form>
      ) : (
        <p className="text-xs text-slate-500">
          В серверном режиме ключи `YANDEX_CLOUD_API_KEY` и `YANDEX_CLOUD_FOLDER` задаются администратором в конфигурации окружения.
        </p>
      )}
    </section>
  );
}
