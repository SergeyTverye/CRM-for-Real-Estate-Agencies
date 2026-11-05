"use client";

import { useEffect, useId, useState } from "react";
import { CheckCircle2, Circle, LoaderCircle } from "lucide-react";
import { apiCall } from "@/ui/api-client";
import { DISTRICTS, normalizeGeography } from "@/modules/property-search/domain/geography";

export type ClientChoice = { id: string; displayName: string };
export type NeedChoice = { id: string; label: string; status: string; client: ClientChoice | null };

export function SearchPicker<T extends { id: string }>({ label, url, value, onChange, render }: {
  label: string; url: string; value: T | null; onChange: (item: T | null) => void; render: (item: T) => string;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<T[]>([]);
  const [status, setStatus] = useState("loading");
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setStatus("loading");
      try {
        const result = await apiCall<{ items: T[] }>("GET", `${url}${url.includes("?") ? "&" : "?"}q=${encodeURIComponent(q)}`);
        if (!cancelled) { setItems(result.items); setActive(0); setStatus("ready"); }
      } catch { if (!cancelled) setStatus("error"); }
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, q, url]);
  return <div className="min-w-0"><label className="label" htmlFor={id}>{label}</label>
    {value ? <div className="flex min-w-0 items-center gap-2 rounded border p-2"><span className="min-w-0 flex-1 break-words text-sm">{render(value)}</span><button type="button" className="btn btn-sm btn-link" onClick={() => { onChange(null); setQ(""); }}>Изменить</button></div> :
      <div className="relative"><input id={id} className="input w-full" role="combobox" aria-expanded={open} aria-controls={`${id}-options`} aria-autocomplete="list" aria-activedescendant={open && items[active] ? `${id}-${active}` : undefined}
        placeholder="Начните вводить название…" value={q} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onChange={e => { setQ(e.target.value); setStatus("loading"); setOpen(true); }}
        onKeyDown={e => { if (e.key === "Escape") setOpen(false); if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); setActive(i => Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))); } if (e.key === "Enter" && open) { e.preventDefault(); if (status === "ready" && items[active]) { onChange(items[active]); setOpen(false); } } }} />
        {open && <div className="absolute inset-x-0 z-30 mt-1 max-h-64 overflow-y-auto rounded border bg-white p-1 shadow-lg">
          {status !== "ready" || !items.length ? <p role="status" className="p-3 text-sm text-slate-500">{status === "loading" ? "Поиск…" : status === "error" ? "Не удалось загрузить. Повторите поиск." : "Доступных записей не найдено"}</p> : null}
          <ul role="listbox" id={`${id}-options`}>{status === "ready" && items.map((item, i) => <li key={item.id} role="option" id={`${id}-${i}`} aria-selected={active === i} onMouseDown={e => e.preventDefault()} onClick={() => { onChange(item); setOpen(false); }} className={`cursor-pointer rounded p-2 text-sm ${active === i ? "bg-blue-50" : "hover:bg-slate-50"}`}>{render(item)}</li>)}</ul>
        </div>}
      </div>}
  </div>;
}

export function DistrictPicker({ city, value, onChange }: { city: string; value: string[]; onChange: (value: string[]) => void }) {
  const [q, setQ] = useState("");
  const districts = DISTRICTS[normalizeGeography(city)] ?? [];
  return <fieldset className="min-w-0 sm:col-span-2"><legend className="text-sm font-medium">Районы · любой из выбранных</legend>
    <div className="my-2 flex flex-wrap gap-1">{value.map(d => <button type="button" key={d} className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-sm" aria-label={`Убрать район ${d}`} onClick={() => onChange(value.filter(v => v !== d))}>{d} ×</button>)}</div>
    {districts.length ? <details className="rounded border bg-white"><summary className="cursor-pointer p-2 text-sm">{value.length ? `Выбрано районов: ${value.length}` : `Выбрать районы (${districts.length})`}</summary>
      <div className="p-2"><input aria-label="Найти район" className="input mb-2 w-full" placeholder="Найти район…" value={q} onChange={e => setQ(e.target.value)} /><div className="grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">{districts.filter(d => normalizeGeography(d).includes(normalizeGeography(q))).map(d => <label className="flex items-center gap-2 text-sm" key={d}><input type="checkbox" checked={value.includes(d)} onChange={e => onChange(e.target.checked ? [...value, d] : value.filter(v => v !== d))} />{d}</label>)}</div></div>
    </details> : <p className="text-xs text-slate-500">Для этого города справочник районов не подключён. Доступен поиск по всему городу.</p>}
  </fieldset>;
}

export function SearchProgress({ phase, completed }: { phase: "parse" | "search" | "web" | null; completed: boolean }) {
  if (!phase && !completed) return null;
  return <div role="status" aria-live="polite" className="rounded border bg-blue-50 p-3"><ol className="flex flex-wrap gap-4 text-sm">{["Разбор ИИ / ручные фильтры", "Поиск площадок", "Анализ и проверка"].map((label, i) => {
    const done = !phase && completed || phase === "search" && i === 0;
    const active = phase === "parse" ? i === 0 : phase === "search" || phase === "web" ? i > 0 : false;
    const Icon = done ? CheckCircle2 : active ? LoaderCircle : Circle;
    return <li key={label} className="flex items-center gap-2"><Icon aria-hidden size={16} className={active ? "animate-spin" : ""} />{label}{active ? "…" : ""}</li>;
  })}</ol>{phase && <p className="mt-2 text-xs text-slate-600">{phase === "parse" ? "ИИ предлагает условия. Проверьте их перед поиском." : "Сервер последовательно получает объявления и проверяет условия; точный прогресс источников появится после ответа."}</p>}</div>;
}
