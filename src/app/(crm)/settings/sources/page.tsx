import Link from "next/link";
import { getConfig } from "@/shared/config/env";
import { envAiLimits } from "@/modules/ai/infrastructure/config";
import { requirePageActor } from "@/server/page-auth";
import { getAiSettings } from "@/modules/ai/application/settings-service";
import { searchAvailability } from "@/modules/property-search/application/availability";
import { labelOf } from "@/shared/codebook";
import { Badge } from "@/ui/components";
import { AiSettingsForm } from "../ai/ai-settings-form";
import styles from "../ai/settings.module.css";
import { describeAvailabilityReason } from "@/app/(crm)/property-search/filter-presentation";

export const metadata = { title: "Источники поиска и скрапер" };

export default async function SourceSettingsPage() {
  const actor = await requirePageActor({ manager: true });
  const [data, availability] = await Promise.all([getAiSettings(actor), searchAvailability()]);
  const config = getConfig();
  const env = envAiLimits(config);

  const ceilings = {
    perUserDailyLimit: env.requestsPerUserDay,
    perJobLimit: env.callsPerJob,
    dailyLimit: env.requestsPerDay!,
    monthlyBudgetRub: config.YANDEX_AI_MAX_MONTHLY_COST_RUB,
    aiEnabled: config.AI_ENABLED,
    scraperEnabled: config.SCRAPER_ENABLED,
    browserEnabled: config.SCRAPER_BROWSER_ENABLED,
    webSearchManualAllowed: config.YANDEX_WEB_SEARCH_ENABLED,
    webSearchAutoFallback: config.YANDEX_WEB_SEARCH_AUTO_FALLBACK,
    searchContextSize: config.YANDEX_WEB_SEARCH_CONTEXT_SIZE,
  };

  return (
    <div className={styles.page}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1>Источники поиска и скрапер</h1>
        <div className="flex flex-wrap gap-2">
          <Link className="btn btn-secondary" href="/property-search">
            К поиску объектов
          </Link>
          <Link className="btn btn-secondary" href="/settings/ai">
            Настройки и бюджет Яндекс AI
          </Link>
        </div>
      </div>
      <p>
        Управление опросом внешних площадок недвижимости (Циан, Авито, Домклик, Яндекс Недвижимость, Мир Квартир,
        OnRealt, Юла) и интерактивным браузерным режимом. Работает независимо от Яндекс AI и не расходует бюджет ИИ.
      </p>

      <section className="card card-body space-y-3" aria-label="Сводка готовности источников">
        <h2>Фактическое состояние среды</h2>
        <dl className="dl">
          <dt>Скрапер площадок</dt>
          <dd>
            <Badge tone={availability.scraper.enabled ? "green" : "yellow"}>
              {describeAvailabilityReason(availability.scraper.reason, "scraper")}
            </Badge>{" "}
            <small className="text-slate-600">
              (в настройках: {data.setting.scraperEnabled ? "вкл." : "выкл."}, настройки сервера:{" "}
              {config.SCRAPER_ENABLED ? "разрешён" : "запрещён"})
            </small>
          </dd>
          <dt>Браузерный режим (Chromium)</dt>
          <dd>
            <Badge tone={availability.browser.enabled ? "blue" : "gray"}>
              {availability.browser.enabled ? "Активен" : "Выключен"}
            </Badge>{" "}
            <small className="text-slate-600">
              (исполняемый файл Chromium:{" "}
              {availability.browser.configured ? "указан администратором" : "автоопределение / встроенный"})
            </small>
          </dd>
          <dt>Активные площадки</dt>
          <dd>
            {availability.sources.filter((s) => s.enabled).length} из {availability.sources.length}:{" "}
            {availability.sources
              .map(
                (s) =>
                  `${labelOf("externalSource", s.source)} (${
                    s.enabled ? "активна" : describeAvailabilityReason(s.reason, "source")
                  })`,
              )
              .join(", ")}
          </dd>
        </dl>
      </section>

      <AiSettingsForm
        key={data.setting.updatedAt}
        data={data}
        ceilings={ceilings}
        timeZone={config.APP_TIMEZONE}
        mode="sources"
        browserConfigured={availability.browser.configured}
      />
    </div>
  );
}
