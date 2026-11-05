import Link from "next/link";
import { requirePageActor } from "@/server/page-auth";
import { getManagerReport } from "@/modules/reports/application/report-service";
import { dictLabel } from "@/modules/dictionaries/application/dictionaries-service";
import { searchParamsToObject } from "@/shared/validation";
import { ValidationError } from "@/shared/errors";
import { labelOf } from "@/shared/codebook";
import { localDateString } from "@/shared/time";
import { fmtDateOnly, fmtDateTime, fmtMoney, tz } from "@/server/format";
import { dictOptions, loadDictionaries, userOptions } from "@/server/options";
import { Card, EmptyState, FilterBar, FilterField, PageHeader, Select } from "@/ui/components";
import { BarTable, FunnelRow, KpiTile, ReportSection, StatLine, type Signal } from "@/ui/domain/report-blocks";

export const metadata = { title: "Отчёты руководителя" };

type Report = Awaited<ReturnType<typeof getManagerReport>>;

/** Строка запроса без пустых значений. */
function qs(params: Record<string, string | null | undefined>): string {
  const sp = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function shiftDate(ymd: string, days: number): string {
  return new Date(new Date(`${ymd}T00:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Быстрые периоды; «90 дней» — baseline апробации (ТЗ 31.5). */
function periodPresets(today: string): { label: string; from: string; to: string }[] {
  const monthStart = `${today.slice(0, 8)}01`;
  const prevMonthEnd = shiftDate(monthStart, -1);
  return [
    { label: "7 дней", from: shiftDate(today, -6), to: today },
    { label: "30 дней", from: shiftDate(today, -29), to: today },
    { label: "90 дней", from: shiftDate(today, -89), to: today },
    { label: "Текущий месяц", from: monthStart, to: today },
    { label: "Прошлый месяц", from: `${prevMonthEnd.slice(0, 8)}01`, to: prevMonthEnd },
  ];
}

const ymdDate = (ymd: string) => fmtDateOnly(new Date(`${ymd}T00:00:00.000Z`));

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageActor({ manager: true });
  const sp = searchParamsToObject(await searchParams);
  const filters = { from: sp.from, to: sp.to, userId: sp.userId, sourceCode: sp.sourceCode };
  let report: Report;
  let filterError = false;
  try {
    report = await getManagerReport(actor, filters);
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
    filterError = true;
    report = await getManagerReport(actor, {});
  }
  const [dicts, users] = await Promise.all([loadDictionaries(), userOptions()]);
  const zone = tz();
  const today = localDateString(new Date(), zone);
  const { from, to } = report.period;
  const userId = report.filters.userId;
  const sourceCode = report.filters.sourceCode;
  const userName = userId ? (users.find((u) => u.value === userId)?.label ?? "выбранный сотрудник") : null;
  const kpi = (key: string) => report.kpis.find((k) => k.key === key);
  const signalOf = (key: string, value: number): Signal => {
    if (value <= 0) return null;
    if (key === "overdue") return "attention";
    if (key === "unprocessedRequests" || key === "staleNeeds") return "warning";
    return null;
  };
  const reportHref = (extra: Record<string, string | null | undefined>) => `/reports${qs({ from, to, userId, sourceCode, ...extra })}`;
  const isDefaultPeriod = !sp.from && !sp.to;

  const { funnel, showings, needs, tasks } = report;
  const withoutNextAction = Math.max(0, needs.active - needs.activeWithNextAction);

  return (
    <div>
      <PageHeader
        title="Отчёты руководителя"
        subtitle={
          <span>
            Период {ymdDate(from)} — {ymdDate(to)} ({report.period.timeZone})
            {userName ? ` · сотрудник: ${userName}` : " · все сотрудники"}
            {sourceCode ? ` · источник: ${dictLabel(dicts, "lead_source", sourceCode)}` : ""}
          </span>
        }
        actions={
          <>
            <Link href="/archive" className="btn">
              Исторический архив
            </Link>
            <a href="/api/v1/export" className="btn" download title="ZIP с CSV-файлами и manifest.json">
              Выгрузить данные (ZIP/CSV)
            </a>
          </>
        }
      />

      <FilterBar action="/reports" resetHref="/reports">
        <FilterField label="С даты">
          <input type="date" name="from" defaultValue={from} max={today} className="input" />
        </FilterField>
        <FilterField label="По дату">
          <input type="date" name="to" defaultValue={to} max={today} className="input" />
        </FilterField>
        <FilterField label="Сотрудник">
          <Select name="userId" value={userId ?? ""} placeholder="Все сотрудники" options={users} />
        </FilterField>
        <FilterField label="Источник обращения">
          <Select name="sourceCode" value={sourceCode ?? ""} placeholder="Все источники" options={dictOptions(dicts, "lead_source", sourceCode)} />
        </FilterField>
      </FilterBar>
      <div className="-mt-1 mb-3 flex flex-wrap items-center gap-1 text-xs text-slate-500">
        <span className="mr-1">Быстрый период:</span>
        {periodPresets(today).map((p) => {
          const active = p.from === from && p.to === to;
          return (
            <Link key={p.label} href={reportHref({ from: p.from, to: p.to })} className={`badge ${active ? "badge-blue" : "badge-gray"} hover:underline`} aria-current={active ? "true" : undefined}>
              {p.label}
            </Link>
          );
        })}
        {isDefaultPeriod ? <span className="ml-1">(по умолчанию — последние 30 дней)</span> : null}
      </div>

      {filterError ? (
        <div className="alert alert-warning mb-3">
          Некорректные параметры фильтра — показан отчёт за последние 30 дней по всем сотрудникам.{" "}
          <Link className="link" href="/reports">
            Сбросить фильтры
          </Link>
        </div>
      ) : null}
      {sourceCode ? (
        <div className="alert alert-info mb-3 text-xs">
          Источник ограничивает обращения периода и связанные с ними записи. Текущие состояния считаются на момент формирования отчёта.
        </div>
      ) : null}

      <Card title="Контроль перспективных обращений и контактов" className="mb-4">
        <StatLine label="Доля перспективных с назначенным действием" value={`${report.contactControl.actionShare}%`} sub={`${report.contactControl.withAction} из ${report.contactControl.prospective}`} href={report.detailLinks.prospectiveWithAction!} />
        <Link className="link" href={report.detailLinks.prospective!}>Все открытые перспективные обращения</Link>
        <StatLine label="Доля контактов в срок" value={`${report.contactControl.onTimeShare}%`} sub={`${report.contactControl.onTime} из ${report.contactControl.completed}`} href={report.detailLinks.contactsOnTime!} />
        <Link className="link" href={report.detailLinks.contactsCompleted!}>Все завершённые контакты среза</Link>
      </Card>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {report.kpis.map((k) => (
          <KpiTile
            key={k.key}
            label={k.label}
            value={k.value}
            href={k.href}
            signal={signalOf(k.key, k.value)}
            hint={k.href ? undefined : k.key === "reactivated" ? "Расчётный показатель (ТЗ 31.5): без отдельного списка" : undefined}
          />
        ))}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ReportSection title="Обращения по источникам" note="Число — ссылка на список обращений периода с тем же источником.">
          <BarTable
            emptyTitle="Обращений за период нет"
            rows={report.requestsBySource.map((r) => ({ key: r.code, label: dictLabel(dicts, "lead_source", r.code), count: r.count, href: r.href }))}
          />
        </ReportSection>
        <ReportSection title="Обращения по каналам">
          <BarTable
            emptyTitle="Обращений за период нет"
            rows={report.requestsByChannel.map((r) => ({
              key: r.code,
              label: dictLabel(dicts, "lead_channel", r.code),
              count: r.count,
              href: r.href,
            }))}
          />
        </ReportSection>
      </div>

      <Card title="Воронка за период" className="mb-4">
        <div className="space-y-5">
          <FunnelRow
            title="Обращение → потребность → показ"
            steps={[
              { label: "Обращения", value: funnel.requests, href: kpi("newRequests")?.href },
              { label: "Потребности из обращений", value: funnel.requestsWithNeed, href: report.detailLinks.requestsWithNeed, note: "уникальные потребности" },
              { label: "Был показ после обращения", value: funnel.requestToShowing, href: report.detailLinks.requestToShowing, note: "по тем же потребностям" },
            ]}
          />
          <FunnelRow
            title="Коммерческое предложение → показ → сделка"
            steps={[
              { label: "КП отправлено", value: funnel.offersSent, href: report.detailLinks.offersSent },
              { label: "Показ после КП", value: funnel.offersToShowing, href: report.detailLinks.offersToShowing, note: "по потребности из КП" },
              { label: "Сделка по объекту из КП", value: funnel.offersToDeal, href: report.detailLinks.offersToDeal },
            ]}
          />
          <FunnelRow
            title="Сделки"
            steps={[
              { label: "Открыто в периоде", value: funnel.dealsOpened, href: kpi("dealsOpened")?.href },
              { label: "Завершено в периоде", value: funnel.dealsCompleted, href: kpi("dealsCompleted")?.href },
            ]}
            footnote="Числа рассчитаны из первичных событий (обращения, КП, показы, сделки); проценты — доля перехода от предыдущего шага. Исторический архив в показатели не входит."
          />
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ReportSection title={`Показы: ${showings.total}`} actions={kpi("showings")?.href ? <Link href={kpi("showings")!.href!} className="btn btn-sm">Список</Link> : null}>
          <div className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">По статусу</div>
          <BarTable
            emptyTitle="Показов за период нет"
            rows={showings.byStatus.map((s) => ({ key: s.code, label: labelOf("showingStatus", s.code), count: s.count, href: s.href }))}
          />
          <div className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Результат проведённых</div>
          <BarTable
            emptyTitle="Проведённых показов нет"
            rows={showings.byResult.map((s) => ({ key: s.code, label: s.code === "—" ? "Результат не указан" : labelOf("showingResult", s.code), count: s.count, href: s.href }))}
          />
        </ReportSection>

        <ReportSection title="Потребности" note="«Без движения» — правило ТЗ 40.6: нет коммуникаций, предложений, показов, смены этапа или выполненных задач за установленный срок.">
          <div className="px-4 py-2">
            <StatLine label="Активные потребности" value={needs.active} href={kpi("activeNeeds")?.href} />
            <StatLine
              label="С корректным следующим действием"
              value={`${needs.nextActionShare}%`}
              href={report.detailLinks.activeWithNextAction}
              sub={`${needs.activeWithNextAction} из ${needs.active}`}
              signal={needs.active > 0 && needs.nextActionShare < 100 ? "warning" : null}
            />
            <StatLine
              label="Без следующего действия"
              value={withoutNextAction}
              href={report.detailLinks.withoutNextAction!}
              signal={withoutNextAction > 0 ? "attention" : null}
            />
            <StatLine label={kpi("staleNeeds")?.label ?? "Без движения"} value={needs.stale} href={kpi("staleNeeds")?.href} signal={needs.stale > 0 ? "warning" : null} />
          </div>
          <div className="px-4 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Закрыты в периоде — по причине</div>
          <BarTable
            emptyTitle="Закрытых потребностей за период нет"
            rows={needs.closedByReason.map((r) => ({ key: r.code, label: r.code === "—" ? "Причина не указана" : labelOf("stopReason", r.code), count: r.count, href: r.href }))}
          />
        </ReportSection>

        <div className="space-y-4">
          <ReportSection title="Задачи и следующие действия" note="Состояние на текущий момент, без учёта периода.">
            <div className="px-4 py-2">
              <StatLine label="Открытые задачи" value={tasks.open} href={report.detailLinks.openTasks!} />
              <StatLine label="Просроченные" value={tasks.overdue} href={kpi("overdue")?.href} signal={tasks.overdue > 0 ? "attention" : null} />
              <StatLine label="Доля просроченных" href={report.detailLinks.overdue} value={`${tasks.overdueShare}%`} sub={`${tasks.overdue} из ${tasks.open}`} />
            </div>
          </ReportSection>
          <ReportSection title="Комиссии получены" note="Сумма поступлений со статусом «получена» или «частично получена» с датой поступления в периоде.">
            <div className="px-4 py-3">
              <div className="text-2xl font-semibold tabular-nums text-slate-900">{fmtMoney(report.commissionsReceived)}</div>
              <Link href={report.detailLinks.commissions!} className="link text-xs">
                Комиссионные записи →
              </Link>
            </div>
          </ReportSection>
        </div>
      </div>

      <ReportSection
        title="Активность сотрудников за период"
        note="Обращения — зарегистрированные сотрудником; коммуникации — записанные им; показы — проведённые; задачи — выполненные; сделки — открытые в периоде; просрочено — открытые задачи с истёкшим сроком на текущий момент. Имя сотрудника открывает этот отчёт с фильтром по нему."
      >
        {report.activity.length === 0 ? (
          <EmptyState title="Нет активных сотрудников" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th className="text-right">Обращения</th>
                <th className="text-right">Коммуникации</th>
                <th className="text-right">Показы</th>
                <th className="text-right">Задачи</th>
                <th className="text-right">Сделки</th>
                <th className="text-right">Просрочено</th>
              </tr>
            </thead>
            <tbody>
              {report.activity.map((a) => (
                <tr key={a.user.id}>
                  <td>
                    <Link href={reportHref({ userId: a.user.id })} className="link">
                      {a.user.displayName}
                    </Link>
                    {a.user.roleCode === "manager" ? <span className="ml-1 text-xs text-slate-400">руководитель</span> : null}
                  </td>
                  <td className="text-right tabular-nums">{<Link className="link" href={report.detailLinks[`activity:${a.user.id}:requests`]!}>{a.requests}</Link>}</td>
                  <td className="text-right tabular-nums">{<Link className="link" href={report.detailLinks[`activity:${a.user.id}:communications`]!}>{a.communications}</Link>}</td>
                  <td className="text-right tabular-nums">{<Link className="link" href={report.detailLinks[`activity:${a.user.id}:showingsCompleted`]!}>{a.showingsCompleted}</Link>}</td>
                  <td className="text-right tabular-nums">{<Link className="link" href={report.detailLinks[`activity:${a.user.id}:tasksCompleted`]!}>{a.tasksCompleted}</Link>}</td>
                  <td className="text-right tabular-nums">{<Link className="link" href={report.detailLinks[`activity:${a.user.id}:dealsOpened`]!}>{a.dealsOpened}</Link>}</td>
                  <td className="text-right tabular-nums">
                    {a.overdue > 0 ? (
                      <Link href={report.detailLinks[`activity:${a.user.id}:overdue`]!} className="font-medium text-red-700 hover:underline">
                        {a.overdue} ⚠
                      </Link>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportSection>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Исторический архив сделок">
          <p className="text-sm text-slate-600">Архив перенесён из исторического реестра Excel, доступен только для чтения и не входит в показатели этого отчёта.</p>
          <Link href="/archive" className="btn btn-sm mt-2">
            Открыть архив
          </Link>
        </Card>
        <Card title="Выгрузка данных">
          <p className="text-sm text-slate-600">
            ZIP с CSV-файлами (UTF-8) и manifest.json — для анализа и переноса данных. Поля, закрытые политикой доступа и минимизации ПДн, не выгружаются. Выгрузка <b>не заменяет</b> техническое резервное копирование — см. раздел{" "}
            <Link href="/operations" className="link">
              «Эксплуатация»
            </Link>
            .
          </p>
          <a href="/api/v1/export" className="btn btn-sm mt-2" download>
            Выгрузить данные (ZIP/CSV)
          </a>
        </Card>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Отчёт сформирован {fmtDateTime(report.generatedAt)}. Показатели вычисляются из первичных событий CRM; вручную редактируемых итогов нет.
      </p>
    </div>
  );
}
