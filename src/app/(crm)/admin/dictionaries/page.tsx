import Link from "next/link";
import { requirePageActor } from "@/server/page-auth";
import { listDictionaryItems } from "@/modules/dictionaries/application/dictionaries-service";
import { DICTIONARY_CATEGORIES, type DictionaryCategory } from "@/modules/dictionaries/domain/dictionary-data";
import { PageHeader } from "@/ui/components";
import { DictionaryEditor } from "@/ui/domain/admin-dictionaries";

export const metadata = { title: "Справочники" };

export default async function AdminDictionariesPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const actor = await requirePageActor({ manager: true });
  const { category: raw } = await searchParams;
  const categories = Object.keys(DICTIONARY_CATEGORIES) as DictionaryCategory[];
  const category: DictionaryCategory = categories.includes(raw as DictionaryCategory) ? (raw as DictionaryCategory) : categories[0]!;
  const all = await listDictionaryItems(actor);
  const counts = new Map<string, { total: number; active: number }>();
  for (const it of all) {
    const c = counts.get(it.category) ?? { total: 0, active: 0 };
    c.total += 1;
    if (it.isActive) c.active += 1;
    counts.set(it.category, c);
  }
  const items = all
    .filter((i) => i.category === category)
    .map((i) => ({ id: i.id, code: i.code, displayName: i.displayName, isActive: i.isActive, sortOrder: i.sortOrder }));

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Бизнес-справочники"
        back={{ href: "/admin", label: "Администрирование" }}
        subtitle="Значения можно добавлять, переименовывать, упорядочивать и деактивировать. Код значения стабилен и не удаляется. Системные статусы и типы (codebook) здесь не редактируются."
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        <nav className="card self-start py-1" aria-label="Справочники">
          {categories.map((c) => {
            const active = c === category;
            const n = counts.get(c);
            return (
              <Link
                key={c}
                href={`/admin/dictionaries?category=${c}`}
                className={`flex items-center justify-between gap-2 px-3 py-1.5 text-sm ${active ? "bg-brand-50 font-medium text-brand-700" : "text-slate-700 hover:bg-slate-50"}`}
                aria-current={active ? "page" : undefined}
              >
                <span>{DICTIONARY_CATEGORIES[c]}</span>
                <span className="text-xs text-slate-400">{n ? n.active : 0}</span>
              </Link>
            );
          })}
        </nav>
        <DictionaryEditor key={category} category={category} categoryLabel={DICTIONARY_CATEGORIES[category]} items={items} />
      </div>
    </div>
  );
}
