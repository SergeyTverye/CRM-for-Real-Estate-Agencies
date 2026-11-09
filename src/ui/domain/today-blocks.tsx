import Link from "next/link";
import type { ControlItem } from "@/modules/tasks/application/task-queries";
import { fmtDateOnly, fmtDateTime } from "@/server/format";
import { Badge } from "../components";

const KIND_LABEL: Record<ControlItem["kind"], string> = {
  showing: "Показ",
  agreement: "Договор",
  advertisement: "Реклама",
  offer: "КП",
};


export function TodayCounter({ label, value, href, tone, hint }: { label: string; value: number; href: string; tone: "red" | "blue" | "gray" | "yellow"; hint?: string }) {
  const color = value === 0 ? "text-slate-400" : tone === "red" ? "text-red-600" : tone === "yellow" ? "text-amber-600" : tone === "blue" ? "text-brand-700" : "text-slate-800";
  return (
    <Link href={href} className="card block px-4 py-3 hover:border-slate-300 hover:bg-slate-50" title={hint}>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      <div className="text-sm text-slate-600">{label}</div>
    </Link>
  );
}


export function ControlRows({ items, showResponsible }: { items: ControlItem[]; showResponsible?: boolean }) {
  
  const recent = new Date().getTime() - 60_000;
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((c) => (
        <li key={`${c.kind}-${c.id}`} className="flex flex-wrap items-start justify-between gap-2 px-4 py-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={c.href} className="font-medium text-slate-900 hover:underline">
                {c.title}
              </Link>
              <Badge tone={c.overdue ? "red" : "yellow"}>{KIND_LABEL[c.kind]} · контроль</Badge>
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              <span className={c.overdue ? "font-medium text-red-600" : ""}>
                {c.kind === "advertisement" && !c.isDateOnly ? "Последняя проверка: " : c.overdue ? "Срок истёк: " : "Срок: "}
                {c.kind === "advertisement" && !c.isDateOnly && c.dateLabel.getTime() >= recent
                  ? "не проводилась"
                  : c.isDateOnly
                    ? fmtDateOnly(c.dateLabel)
                    : fmtDateTime(c.dateLabel)}
              </span>
              {showResponsible && c.responsibleName ? <span> · {c.responsibleName}</span> : null}
            </div>
          </div>
          <Link href={c.href} className="btn btn-sm shrink-0">
            Открыть
          </Link>
        </li>
      ))}
    </ul>
  );
}
