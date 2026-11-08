"use client";
import { useState } from "react";
import { SEARCH_LOCATIONS, locationSummary } from "@/modules/property-search/domain/geography";
import { chooseLocations } from "@/modules/property-search/domain/geography";
import type { SearchFilters } from "@/modules/property-search/domain/types";

export function LocationPicker({ filters, onChange, implicitDefault = false }: { filters: SearchFilters; onChange: (filters: SearchFilters) => void; implicitDefault?: boolean }) {
  const [query, setQuery] = useState("");
  const selected = filters.locations ?? SEARCH_LOCATIONS.filter(l => l.city === filters.city && !["group", "district"].includes(l.kind)).map(l => l.id);
  return <fieldset className="min-w-0 sm:col-span-2 xl:col-span-4"><legend className="text-sm font-medium">Локации · любая из выбранных</legend>
    <input aria-label="Найти локацию" className="input mt-1 w-full" placeholder="Город, район или населённый пункт области…" value={query} onChange={e => setQuery(e.target.value)} />
    <div className="my-2 flex flex-wrap gap-2">{SEARCH_LOCATIONS.filter(l => l.label.toLocaleLowerCase("ru").includes(query.toLocaleLowerCase("ru"))).map(l => <button type="button" aria-pressed={selected.includes(l.id)} key={l.id} className={`rounded-full border px-3 py-1 text-sm ${selected.includes(l.id) ? "border-blue-300 bg-blue-50 text-blue-900" : "bg-white"}`} onClick={() => {
      const locations = chooseLocations(selected, l.id, implicitDefault);
      if (!locations.length) { if (implicitDefault) onChange({ ...filters, locations: [l.id] }); return; }
      onChange({ ...filters, city: SEARCH_LOCATIONS.find(v => v.id === locations[0])!.city, locations, districts: [] });
    }}>{l.label}{selected.includes(l.id) ? " ✓" : ""}</button>)}</div>
    {query.trim() && !SEARCH_LOCATIONS.some(l => l.label.toLocaleLowerCase("ru").includes(query.toLocaleLowerCase("ru"))) && <button type="button" className="btn btn-secondary my-2" onClick={() => { onChange({ ...filters, city: query.trim(), locations: undefined, districts: [] }); setQuery(""); }}>Искать в городе «{query.trim()}»</button>}
    <p className="text-xs text-slate-600">{implicitDefault ? "Новосибирск задан по умолчанию: выбор другой локации заменит его. Чтобы искать в двух местах, затем добавьте Новосибирск. " : ""}Выбрано: {locationSummary(filters)}. Академгородок: поиск по Советскому району. Пригороды: Бердск, Обь, Кольцово и Краснообск. Адрес проверяется после получения объявлений.</p>
  </fieldset>;
}
