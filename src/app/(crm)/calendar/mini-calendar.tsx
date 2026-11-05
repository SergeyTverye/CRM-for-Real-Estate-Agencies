"use client";
import { useState } from "react";
export function MiniCalendar({ onSelect, initial }: { onSelect: (day: string) => void; initial: string }) {
  const [month, setMonth] = useState(initial.slice(0,7));
  const first = new Date(`${month}-01T00:00:00Z`), offset = (first.getUTCDay()+6)%7;
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth()+1,0)).getUTCDate();
  function move(delta: number) { const next = new Date(first); next.setUTCMonth(next.getUTCMonth()+delta); setMonth(next.toISOString().slice(0,7)); }
  return <details className="rounded border bg-white p-2"><summary className="cursor-pointer text-sm">Мини-календарь</summary><div className="w-64 p-2"><div className="flex justify-between gap-2"><button type="button" className="btn btn-sm" aria-label="Предыдущий месяц мини-календаря" onClick={() => move(-1)}>‹</button><span>{new Intl.DateTimeFormat("ru", { month: "long", year: "numeric", timeZone: "UTC" }).format(first)}</span><button type="button" className="btn btn-sm" aria-label="Следующий месяц мини-календаря" onClick={() => move(1)}>›</button></div><div className="mt-2 grid grid-cols-7 gap-1 text-center text-xs">{["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].map(d => <span key={d}>{d}</span>)}{Array.from({ length: offset }, (_,i) => <span key={`blank${i}`} />)}{Array.from({ length: count }, (_,i) => <button key={i} type="button" className="rounded p-1 hover:bg-slate-100 focus-visible:outline-2" onClick={() => onSelect(`${month}-${String(i+1).padStart(2,"0")}`)}>{i+1}</button>)}</div></div></details>;
}
