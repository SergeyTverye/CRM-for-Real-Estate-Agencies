import Link from "next/link";
import { getConfig } from "@/shared/config/env";
import { envAiLimits } from "@/modules/ai/infrastructure/config";
import { periodKeys } from "@/modules/ai/domain/gate";
import { fmtDateTime, fmtMoney } from "@/server/format";
import { requirePageActor } from "@/server/page-auth";
import { userOptions } from "@/server/options";
import { getAiSettings, getAiUsage } from "@/modules/ai/application/settings-service";
import { aiCredentialsService } from "@/modules/ai/application/credentials-service";
import { searchAvailability } from "@/modules/property-search/application/availability";
import { AiSettingsForm } from "./ai-settings-form";
import { AiCredentialsCard } from "./ai-credentials-card";
import { todayUsage, availableBudget } from "./usage-presentation";
import { labelOf } from "@/shared/codebook";
import styles from "./settings.module.css";

export default async function AiSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; page?: string }>;
}) {
  const actor = await requirePageActor({ manager: true });
  const query = await searchParams;
  const [data, usage, employees, credentialsStatus, availability] = await Promise.all([
    getAiSettings(actor),
    getAiUsage(actor, { month: query.month, page: query.page }),
    userOptions(),
    aiCredentialsService().status(actor),
    searchAvailability(),
  ]);
  const config = getConfig(),
    env = envAiLimits(config),
    now = new Date();
  const currentMonth = periodKeys(now, config.APP_TIMEZONE).monthKey;
  const current =
    usage.month === currentMonth && usage.page === 1
      ? usage
      : await getAiUsage(actor, { month: currentMonth });
  const todayRows = [...current.items];
  // Use the existing authorized ledger query; include every page, not just the visible 50 calls.
  for (let page = 2; page <= Math.ceil(current.total / current.pageSize); page++) {
    todayRows.push(...(await getAiUsage(actor, { month: currentMonth, page })).items);
  }
  const today = todayUsage(todayRows, now, config.APP_TIMEZONE);
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
  const webJobsLimit = Math.min(data.setting.perUserDailyLimit, env.webJobsPerUserDay);
  return (
    <div className={styles.page}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1>Настройки Яндекс AI</h1>
        <div className="flex flex-wrap gap-2">
          <Link className="btn btn-secondary" href="/settings/sources">
            Отдельная страница: Источники поиска
          </Link>
          <Link className="btn btn-secondary" href="/property-search">
            К поиску объектов
          </Link>
        </div>
      </div>
      <p>
        Пределы задаются администратором установки. Неизвестный расход сохраняет резерв; повтор платного запроса требует
        нового разрешения.
      </p>

      <AiCredentialsCard initialStatus={credentialsStatus} aiEnabled={data.setting.aiEnabled} />

      <section className="card card-body space-y-3" aria-label="Действующие ограничения ИИ">
        <h2>Действует сейчас · текущий месяц {currentMonth}</h2>
        <dl className="dl">
          <dt>Месячный бюджет</dt>
          <dd>
            {fmtMoney(data.effective.values.monthlyBudgetRub)} (максимум администратора {fmtMoney(ceilings.monthlyBudgetRub)})
          </dd>
          <dt>Учтено после завершения</dt>
          <dd>{fmtMoney(availableBudget(current.committedRub, current.reservedRub))}</dd>
          <dt>Зарезервировано</dt>
          <dd>{fmtMoney(current.reservedRub)}</dd>
          <dt>Доступный остаток</dt>
          <dd className="font-semibold">
            {fmtMoney(availableBudget(data.effective.values.monthlyBudgetRub, current.committedRub))}
          </dd>
          <dt>Сегодня, всё агентство</dt>
          <dd>
            {today.calls} / {data.effective.values.dailyLimit} вызовов
          </dd>
          <dt>На сотрудника в сутки</dt>
          <dd>
            {data.effective.values.perUserDailyLimit} вызовов; веб-заданий: {webJobsLimit} (максимум веб-заданий:{" "}
            {env.webJobsPerUserDay})
          </dd>
          <dt>На задание</dt>
          <dd>
            {data.effective.values.perJobLimit} AI-вызовов; веб-вызовов:{" "}
            {Math.min(data.setting.perJobLimit, env.webCallsPerJob)} (максимум веб-вызовов: {env.webCallsPerJob})
          </dd>
          <dt>На сотрудника в час</dt>
          <dd>{env.requestsPerUserHour} вызовов (настройка сервера)</dd>
        </dl>
        <p>
          Сутки и месяц считаются в {config.APP_TIMEZONE}. Резерв уменьшает остаток сразу. Учтённый расход может
          включать консервативную оценку, если провайдер не сообщил фактическую стоимость. Известный факт:{" "}
          {fmtMoney(current.actualRub)}.
        </p>
        <p>
          Веб-поиск требует одновременно включённого ИИ, подключённых учётных данных Яндекс AI, разрешения веб-поиска и
          свободных общих лимитов. Автопереход дополнительно требует отдельного разрешения.
        </p>
        <table>
          <thead>
            <tr>
              <th>Сотрудник</th>
              <th>AI-вызовов сегодня</th>
              <th>Веб-заданий сегодня</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((u) => {
              const used = today.users.find((r) => r.userId === u.value);
              return (
                <tr key={u.value}>
                  <td>{u.label}</td>
                  <td>
                    {used?.calls ?? 0} / {data.effective.values.perUserDailyLimit}
                  </td>
                  <td>
                    {used?.webJobs ?? 0} / {webJobsLimit}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <AiSettingsForm
        key={data.setting.updatedAt}
        data={data}
        ceilings={ceilings}
        timeZone={config.APP_TIMEZONE}
        mode="ai"
        browserConfigured={availability.browser.configured}
      />

      <h2>Тарифы</h2>
      <p>
        Стартовые тарифы требуют подтверждения руководителем. Источник:{" "}
        <a href="https://aistudio.yandex.ru/ru/docs/ai-studio/pricing" target="_blank" rel="noreferrer">
          Yandex AI Studio
        </a>
        . Старые версии сохраняются.
      </p>
      {data.tariffs.length ? (
        <table>
          <thead>
            <tr>
              <th>Модель</th>
              <th>Единица</th>
              <th>₽</th>
              <th>Действует с</th>
            </tr>
          </thead>
          <tbody>
            {data.tariffs.map((r) => (
              <tr key={r.id}>
                <td>{r.model}</td>
                <td>{labelOf("aiTariffUnit", r.unit)}</td>
                <td>{r.priceRub}</td>
                <td>{fmtDateTime(r.effectiveFrom).replace(",", "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>Тарифы не заданы. Платные вызовы запрещены до добавления тарифа.</p>
      )}
      <h2>Журнал затрат</h2>
      <form method="get">
        <label>
          Месяц <input name="month" type="month" defaultValue={usage.month} />
        </label>
        <button type="submit" className="btn">
          Показать
        </button>
      </form>
      <p>
        Выбранный месяц {usage.month}. Учтено и зарезервировано: {fmtMoney(usage.committedRub)}. Известный факт:{" "}
        {fmtMoney(usage.actualRub)}. Незавершённые резервы: {fmtMoney(usage.reservedRub)}.
      </p>
      {usage.total ? (
        <table>
          <thead>
            <tr>
              <th>Время</th>
              <th>Сотрудник / задание</th>
              <th>Вызов / модель</th>
              <th>Токены вх./вых.</th>
              <th>Поиск</th>
              <th>Оценка / факт, ₽</th>
              <th>Результат / мс</th>
            </tr>
          </thead>
          <tbody>
            {usage.items.map((r) => (
              <tr key={r.id}>
                <td>{fmtDateTime(r.createdAt).replace(",", "")}</td>
                <td>
                  {r.user}
                  <br />
                  {r.jobId ? "Поисковое задание" : "Без задания"}
                </td>
                <td>
                  {labelOf("aiCallType", r.callType)}
                  <br />
                  {r.model}
                </td>
                <td>
                  {r.inputTokens} / {r.outputTokens}
                </td>
                <td>{r.webSearchCalls}</td>
                <td>
                  {r.estimatedCostRub} / {r.actualCostRub ?? "неизвестно"}
                  <br />
                  Учтено: {r.chargedCostRub}
                </td>
                <td>
                  {labelOf("aiUsageStatus", r.status)} / {r.durationMs ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>В этом месяце AI-вызовов нет.</p>
      )}
      <nav aria-label="Страницы журнала">
        {usage.page > 1 && (
          <Link className="btn" href={`?month=${usage.month}&page=${usage.page - 1}`}>
            Назад
          </Link>
        )}{" "}
        Страница {usage.page}{" "}
        {usage.total > usage.page * usage.pageSize && (
          <Link className="btn" href={`?month=${usage.month}&page=${usage.page + 1}`}>
            Далее
          </Link>
        )}
      </nav>
    </div>
  );
}
