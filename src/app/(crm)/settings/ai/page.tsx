import Link from "next/link";
import { requirePageActor } from "@/server/page-auth";
import { getAiSettings, getAiUsage } from "@/modules/ai/application/settings-service";
import { AiSettingsForm } from "./ai-settings-form";
import { labelOf } from "@/shared/codebook";

export default async function AiSettingsPage({ searchParams }: { searchParams: Promise<{ month?: string; page?: string }> }) {
  const actor = await requirePageActor({ manager: true });
  const query = await searchParams;
  const [data, usage] = await Promise.all([getAiSettings(actor), getAiUsage(actor, { month: query.month, page: query.page })]);
  return <div className="stack">
    <h1>ИИ и источники поиска</h1>
    <p>ENV задаёт предельные разрешения и лимиты. Неизвестный расход сохраняет резерв; повтор платного запроса требует нового разрешения.</p>
    <AiSettingsForm key={data.setting.updatedAt} data={data} />
    <h2>Тарифы</h2>
    <p>Стартовые тарифы требуют подтверждения руководителем. Источник: <a href="https://aistudio.yandex.ru/ru/docs/ai-studio/pricing" target="_blank" rel="noreferrer">Yandex AI Studio</a>, проверено 05.11.2026. Старые версии сохраняются.</p>
    {data.tariffs.length ? <table><thead><tr><th>Модель</th><th>Единица</th><th>₽</th><th>Действует с</th></tr></thead><tbody>{data.tariffs.map((r) => <tr key={r.id}><td>{r.model}</td><td>{labelOf("aiTariffUnit", r.unit)}</td><td>{r.priceRub}</td><td>{r.effectiveFrom}</td></tr>)}</tbody></table> : <p>Тарифы не заданы. Платные вызовы запрещены до добавления тарифа.</p>}
    <h2>Журнал затрат</h2>
    <form method="get"><label>Месяц <input name="month" type="month" defaultValue={usage.month} /></label> <button type="submit">Показать</button></form>
    <p>Учтено и зарезервировано: {usage.committedRub} ₽. Известный факт: {usage.actualRub} ₽. Незавершённые резервы: {usage.reservedRub} ₽.</p>
    {usage.total ? <table><thead><tr><th>Время</th><th>Сотрудник / задание</th><th>Вызов / модель</th><th>Токены вх./вых.</th><th>Поиск</th><th>Оценка / факт, ₽</th><th>Результат / мс</th></tr></thead><tbody>{usage.items.map((r) => <tr key={r.id}>
      <td>{r.createdAt}</td><td>{r.user}<br />{r.jobId}</td><td>{labelOf("aiCallType", r.callType)}<br />{r.model}</td><td>{r.inputTokens} / {r.outputTokens}</td><td>{r.webSearchCalls}</td><td>{r.estimatedCostRub} / {r.actualCostRub ?? "неизвестно"}<br />Учтено: {r.chargedCostRub}</td><td>{labelOf("aiUsageStatus", r.status)} / {r.durationMs ?? "—"}</td>
    </tr>)}</tbody></table> : <p>В этом месяце AI-вызовов нет.</p>}
    <nav aria-label="Страницы журнала">{usage.page > 1 && <Link href={`?month=${usage.month}&page=${usage.page - 1}`}>Назад</Link>} Страница {usage.page} {usage.total > usage.page * usage.pageSize && <Link href={`?month=${usage.month}&page=${usage.page + 1}`}>Далее</Link>}</nav>
  </div>;
}
