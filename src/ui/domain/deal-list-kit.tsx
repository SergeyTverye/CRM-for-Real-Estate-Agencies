import Link from "next/link";




export function listHref(basePath: string, params: Record<string, string>, overrides: Record<string, string | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (k !== "page" && v) sp.set(k, v);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null || v === "") sp.delete(k);
    else sp.set(k, v);
  }
  const qs = sp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}


export function ViewTabs({
  basePath,
  params,
  current,
  views,
  param = "view",
  defaultKey = "all",
}: {
  basePath: string;
  params: Record<string, string>;
  current: string;
  views: { key: string; label: string; hint?: string }[];
  param?: string;
  
  defaultKey?: string;
}) {
  return (
    <nav className="mb-3 flex flex-wrap gap-1 border-b border-slate-200" aria-label="Представления списка">
      {views.map((v) => {
        const active = v.key === current;
        return (
          <Link
            key={v.key}
            href={listHref(basePath, params, { [param]: v.key === defaultKey ? null : v.key })}
            title={v.hint}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${active ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
            aria-current={active ? "page" : undefined}
          >
            {v.label}
          </Link>
        );
      })}
    </nav>
  );
}


export function FilterChip({ label, removeHref }: { label: React.ReactNode; removeHref: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-brand-100 bg-brand-50 px-2.5 py-0.5 text-xs text-brand-700">
      {label}
      <Link href={removeHref} className="ml-1 text-brand-600 hover:underline" aria-label="Снять фильтр">
        ✕
      </Link>
    </span>
  );
}


export function sumMoney(values: ({ toString(): string } | null | undefined)[]): string {
  let cents = BigInt(0);
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const s = v.toString();
    const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
    if (!m) continue;
    const c = BigInt(m[2]!) * BigInt(100) + BigInt((m[3] ?? "").padEnd(2, "0") || "0");
    cents += m[1] ? -c : c;
  }
  const neg = cents < BigInt(0);
  const abs = neg ? -cents : cents;
  const whole = abs / BigInt(100);
  const frac = abs % BigInt(100);
  return `${neg ? "-" : ""}${whole.toString()}${frac ? `.${frac.toString().padStart(2, "0")}` : ""}`;
}
