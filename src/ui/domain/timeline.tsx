import Link from "next/link";
import type { TimelineEvent } from "@/modules/clients/application/client-queries";
import type { Dictionaries } from "@/modules/dictionaries/application/dictionaries-service";
import { fmtDateTime } from "@/server/format";
import { Card, EmptyState } from "../components";

const KIND_LABEL: Record<TimelineEvent["kind"], string> = {
  request: "Обращение",
  communication: "Коммуникация",
  need: "Потребность",
  match: "Подбор",
  showing: "Показ",
  stage: "Этап",
  task: "Задача",
  deal: "Сделка",
  offer: "КП",
};

const KIND_COLOR: Record<TimelineEvent["kind"], string> = {
  request: "bg-blue-500",
  communication: "bg-sky-500",
  need: "bg-indigo-500",
  match: "bg-violet-500",
  showing: "bg-emerald-500",
  stage: "bg-slate-400",
  task: "bg-amber-500",
  deal: "bg-green-600",
  offer: "bg-fuchsia-500",
};


export function Timeline({ events }: { events: TimelineEvent[]; dicts?: Dictionaries }) {
  return (
    <Card bodyClassName="">
      {events.length === 0 ? (
        <EmptyState title="История пуста" />
      ) : (
        <ol className="relative ml-4 border-l border-slate-200 py-3">
          {events.map((e, i) => (
            <li key={i} className="mb-3 ml-4">
              <span className={`absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full ${KIND_COLOR[e.kind]}`} aria-hidden />
              <div className="text-xs text-slate-500">
                {fmtDateTime(e.at)} · {KIND_LABEL[e.kind]}
                {e.author ? ` · ${e.author}` : ""}
              </div>
              <div className="text-sm">
                {e.href ? (
                  <Link className="link" href={e.href}>
                    {e.title}
                  </Link>
                ) : (
                  e.title
                )}
              </div>
              {e.details ? <div className="whitespace-pre-line text-sm text-slate-600">{e.details}</div> : null}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
