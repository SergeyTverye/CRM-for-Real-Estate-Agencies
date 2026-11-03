import Link from "next/link";

/** Серверно-безопасные компоненты разметки (без состояния). */

export function PageHeader({ title, subtitle, actions, back }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-4">
      {back ? (
        <Link href={back.href} className="text-xs text-slate-500 hover:underline">
          ← {back.label}
        </Link>
      ) : null}
      <div className="mt-0.5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          {subtitle ? <div className="mt-0.5 text-sm text-slate-500">{subtitle}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export type Tone = "gray" | "blue" | "green" | "yellow" | "red";

export function Badge({ tone = "gray", children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  active: "green",
  success: "green",
  completed: "green",
  signed: "green",
  received: "green",
  accepted: "green",
  verified: "green",
  processed: "green",
  interested: "green",
  paused: "yellow",
  planned: "blue",
  in_progress: "blue",
  proposed: "blue",
  showing_planned: "blue",
  prepared: "blue",
  sent: "blue",
  open: "blue",
  negotiating: "blue",
  due: "yellow",
  partially_received: "yellow",
  draft: "gray",
  inactive: "gray",
  archived: "gray",
  closed: "gray",
  cancelled: "gray",
  withdrawn: "gray",
  removed: "gray",
  expired: "red",
  rejected: "red",
  failed: "red",
  terminated: "red",
  declined: "red",
  no_show: "red",
  no_agreement: "yellow",
};

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <Badge tone={STATUS_TONES[status] ?? "gray"}>{label}</Badge>;
}

export function Card({ title, actions, children, className, bodyClassName }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={`card ${className ?? ""}`}>
      {title || actions ? (
        <div className="card-header">
          <h2 className="card-title">{title}</h2>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={bodyClassName ?? "card-body"}>{children}</div>
    </section>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <div className="text-sm font-medium text-slate-700">{title}</div>
      {hint ? <div className="max-w-md text-sm text-slate-500">{hint}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Пагинация списков с сохранением фильтров (NFR-21). */
export function Pagination({ page, pageSize, total, basePath, params }: { page: number; pageSize: number; total: number; basePath: string; params: Record<string, string> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const sp = new URLSearchParams({ ...params, page: String(p) });
    return `${basePath}?${sp.toString()}`;
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-sm text-slate-500">
      <span>
        {from}–{to} из {total}
      </span>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link className="btn btn-sm" href={href(page - 1)}>
            ← Назад
          </Link>
        ) : null}
        <span className="px-2">
          стр. {page} из {pages}
        </span>
        {page < pages ? (
          <Link className="btn btn-sm" href={href(page + 1)}>
            Вперёд →
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** Вкладки карточки через параметр ?tab= (серверный рендер). */
export function Tabs({ tabs, current, basePath }: { tabs: { key: string; label: string; count?: number }[]; current: string; basePath: string }) {
  return (
    <nav className="mb-4 flex gap-1 border-b border-slate-200" aria-label="Разделы карточки">
      {tabs.map((t) => {
        const active = t.key === current;
        return (
          <Link
            key={t.key}
            href={`${basePath}?tab=${t.key}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${active ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
            aria-current={active ? "page" : undefined}
          >
            {t.label}
            {t.count !== undefined ? <span className="ml-1 text-xs text-slate-400">{t.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** GET-форма фильтров списка: применяется перезагрузкой страницы с параметрами (серверная фильтрация). */
export function FilterBar({ action, children, resetHref }: { action: string; children: React.ReactNode; resetHref?: string }) {
  return (
    <form method="get" action={action} className="mb-3 flex flex-wrap items-end gap-2">
      {children}
      <button type="submit" className="btn btn-primary">
        Применить
      </button>
      {resetHref ? (
        <Link href={resetHref} className="btn">
          Сбросить
        </Link>
      ) : null}
    </form>
  );
}

export function FilterField({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col ${className ?? ""}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function Select({ name, options, value, placeholder, className }: { name: string; options: { value: string; label: string }[]; value?: string; placeholder?: string; className?: string }) {
  return (
    <select name={name} defaultValue={value ?? ""} className={`input ${className ?? ""}`}>
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Dl({ items }: { items: [React.ReactNode, React.ReactNode][] }) {
  return (
    <dl className="dl">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt>{k}</dt>
          <dd>{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
