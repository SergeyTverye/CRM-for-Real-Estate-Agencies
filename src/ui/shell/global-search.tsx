"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface SearchHit {
  id: string;
  title: string;
  subtitle?: string | null;
  href: string;
}
interface SearchGroup {
  kind: string;
  label: string;
  items: SearchHit[];
}


export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/v1/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal, credentials: "same-origin" });
        if (res.ok) {
          const data = (await res.json()) as { groups: SearchGroup[] };
          setGroups(data.groups);
          setOpen(true);
        }
      } catch {
        
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="global-search relative w-full max-w-xl" ref={boxRef}>
      <input
        type="search"
        className="input"
        placeholder="Поиск: клиент, телефон, e-mail, адрес, сделка, задача…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => groups.length && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter") {
            const first = groups.find((g) => g.items.length)?.items[0];
            if (first) {
              setOpen(false);
              router.push(first.href);
            }
          }
        }}
        aria-label="Глобальный поиск"
      />
      {open && q.trim().length >= 2 ? (
        <div className="absolute left-0 right-0 z-40 mt-1 max-h-[70vh] overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {loading && total === 0 ? <div className="px-3 py-2 text-sm text-slate-500">Поиск…</div> : null}
          {!loading && total === 0 ? <div className="px-3 py-2 text-sm text-slate-500">Ничего не найдено среди доступных вам записей</div> : null}
          {groups
            .filter((g) => g.items.length)
            .map((g) => (
              <div key={g.kind} className="border-b border-slate-100 last:border-0">
                <div className="bg-slate-50 px-3 py-1 text-xs font-semibold uppercase text-slate-500">{g.label}</div>
                {g.items.map((it) => (
                  <Link key={`${g.kind}-${it.id}`} href={it.href} className="block px-3 py-1.5 hover:bg-slate-50" onClick={() => setOpen(false)}>
                    <div className="text-sm">{it.title}</div>
                    {it.subtitle ? <div className="text-xs text-slate-500">{it.subtitle}</div> : null}
                  </Link>
                ))}
              </div>
            ))}
        </div>
      ) : null}
    </div>
  );
}
