import Link from "next/link";
import { Card, EmptyState } from "../components";

/**
 * Серверные блоки отчёта руководителя (ТЗ 37.13): несколько проверяемых цифр, каждая — с drill-down.
 * Цвет — только сигнал; смысл передаётся текстом («требует внимания»).
 */

export type Signal = "attention" | "warning" | null;

export function KpiTile({ label, value, href, signal, hint }: { label: string; value: React.ReactNode; href?: string; signal?: Signal; hint?: string }) {
  const color = signal === "attention" ? "text-red-700" : signal === "warning" ? "text-amber-700" : "text-slate-900";
  const border = signal === "attention" ? "border-l-4 border-l-red-500" : signal === "warning" ? "border-l-4 border-l-amber-400" : "";
  const body = (
    <>
      <div className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="text-sm text-slate-700">{label}</div>
      {signal ? <div className={`mt-0.5 text-xs font-medium ${color}`}>{signal === "attention" ? "⚠ требует внимания" : "проверьте список"}</div> : null}
      <div className="mt-1 text-xs text-slate-400">{href ? "Открыть список →" : (hint ?? "Расчётный показатель")}</div>
    </>
  );
  if (!href) {
    return (
      <div className={`card block px-4 py-3 ${border}`} title={hint}>
        {body}
      </div>
    );
  }
  return (
    <Link href={href} className={`card block px-4 py-3 hover:border-slate-300 hover:bg-slate-50 ${border}`} title={hint}>
      {body}
    </Link>
  );
}

export interface BarRow {
  key: string;
  label: string;
  count: number;
  href?: string;
}

/** Таблица «значение — количество — доля» с CSS-полосой; строка ведёт в отфильтрованный список. */
export function BarTable({ rows, emptyTitle, totalLabel = "Всего", unit = "" }: { rows: BarRow[]; emptyTitle: string; totalLabel?: string; unit?: string }) {
  if (rows.length === 0) return <EmptyState title={emptyTitle} />;
  const total = rows.reduce((s, r) => s + r.count, 0);
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Значение</th>
          <th className="w-20 text-right">Кол-во</th>
          <th className="w-16 text-right">Доля</th>
          <th className="w-2/5">
            <span className="sr-only">Распределение</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>
              {r.href ? (
                <Link href={r.href} className="link">
                  {r.label}
                </Link>
              ) : (
                r.label
              )}
            </td>
            <td className="text-right font-medium tabular-nums">
              {r.href ? (
                <Link href={r.href} className="link" title="Открыть отфильтрованный список">
                  {r.count}
                  {unit}
                </Link>
              ) : (
                `${r.count}${unit}`
              )}
            </td>
            <td className="text-right text-slate-500 tabular-nums">{pct(r.count, total)}</td>
            <td className="align-middle">
              <div className="h-2 w-full rounded bg-slate-100" aria-hidden>
                <div className="h-2 rounded bg-brand-500/60" style={{ width: `${Math.max(2, Math.round((r.count / max) * 100))}%` }} />
              </div>
            </td>
          </tr>
        ))}
        <tr>
          <td className="font-medium text-slate-600">{totalLabel}</td>
          <td className="text-right font-semibold tabular-nums">{total}</td>
          <td className="text-right text-slate-500">100%</td>
          <td />
        </tr>
      </tbody>
    </table>
  );
}

export function pct(part: number, whole: number): string {
  if (!whole) return "—";
  return `${Math.round((part / whole) * 1000) / 10}%`;
}

export interface FunnelStep {
  label: string;
  value: number;
  href?: string;
  note?: string;
}

/** Воронка с абсолютными числами; доля перехода от предыдущего шага — вспомогательная подпись. */
export function FunnelRow({ title, steps, footnote }: { title: string; steps: FunnelStep[]; footnote?: string }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <ol className="flex flex-wrap items-stretch gap-2">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-stretch gap-2">
            {i > 0 ? (
              <div className="flex flex-col items-center justify-center px-1 text-xs text-slate-400" aria-hidden>
                <span>→</span>
                <span className="tabular-nums">{pct(s.value, steps[i - 1]!.value)}</span>
              </div>
            ) : null}
            <div className="min-w-36 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-xl font-semibold tabular-nums text-slate-900">
                {s.href ? (
                  <Link href={s.href} className="hover:underline">
                    {s.value}
                  </Link>
                ) : (
                  s.value
                )}
              </div>
              <div className="text-xs text-slate-600">{s.label}</div>
              {i > 0 ? <div className="sr-only">Переход от предыдущего шага: {pct(s.value, steps[i - 1]!.value)}</div> : null}
              {s.note ? <div className="mt-0.5 text-[11px] text-slate-400">{s.note}</div> : null}
            </div>
          </li>
        ))}
      </ol>
      {footnote ? <p className="mt-2 text-xs text-slate-500">{footnote}</p> : null}
    </div>
  );
}

/** Небольшая карточка «число + подпись + ссылка» внутри блока. */
export function StatLine({ label, value, href, signal, sub }: { label: string; value: React.ReactNode; href?: string; signal?: Signal; sub?: React.ReactNode }) {
  const color = signal === "attention" ? "text-red-700" : signal === "warning" ? "text-amber-700" : "text-slate-900";
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1.5 last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm text-slate-700">{label}</div>
        {sub ? <div className="text-xs text-slate-500">{sub}</div> : null}
      </div>
      <div className={`shrink-0 text-right text-lg font-semibold tabular-nums ${color}`}>
        {href ? (
          <Link href={href} className="hover:underline" title="Открыть список">
            {value}
          </Link>
        ) : (
          value
        )}
        {signal === "attention" ? <span className="ml-1 text-xs font-medium">⚠</span> : null}
      </div>
    </div>
  );
}

export function ReportSection({ title, children, actions, note }: { title: string; children: React.ReactNode; actions?: React.ReactNode; note?: string }) {
  return (
    <Card title={title} actions={actions} bodyClassName="">
      {children}
      {note ? <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">{note}</p> : null}
    </Card>
  );
}
