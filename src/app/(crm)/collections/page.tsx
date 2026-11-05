import Link from "next/link";
import { requirePageActor } from "@/server/page-auth";
import { listCollections } from "@/modules/collections/application/collection-service";
import { PageHeader, Card, EmptyState } from "@/ui/components";
import { CollectionCreate } from "./workspace";
export default async function CollectionsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const actor = await requirePageActor();
  const result = await listCollections(actor, await searchParams);
  return <div><PageHeader title="Подборки" subtitle="Сохраняйте варианты независимо от клиента" /><CollectionCreate /><Card title="Именованные подборки">
    {!result.items.length ? <EmptyState title="Подборок пока нет" hint="Создайте подборку, затем добавьте объявления из поиска или объекты CRM." /> : <table className="table"><thead><tr><th>Название</th><th>Владелец</th><th>Видимость</th><th>Элементов</th></tr></thead><tbody>{result.items.map(c => <tr key={c.id}><td><Link className="link" href={`/collections/${c.id}`}>{c.name}</Link></td><td>{c.owner.displayName}</td><td>{c.visibility === "team" ? "Командная" : "Личная"}</td><td>{c._count.items}</td></tr>)}</tbody></table>}
    <div className="flex gap-3 p-3">{result.page > 1 && <Link href={`?page=${result.page - 1}`}>Назад</Link>}{result.page * 30 < result.total && <Link href={`?page=${result.page + 1}`}>Далее</Link>}</div>
  </Card></div>;
}
