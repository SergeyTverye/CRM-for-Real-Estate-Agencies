import Link from "next/link";
import type { Actor } from "@/modules/auth/domain/actor";
import { listCollections } from "@/modules/collections/application/collection-service";
import { Card } from "@/ui/components";
export async function NeedCollectionsBlock({ actor, needId }: { actor: Actor; needId: string }) {
  // The need card has its own policy; collections require client visibility too.
  let result;
  try {
    result = await listCollections(actor, { needId });
  } catch (e) { if (e instanceof Error && e.name === "NotFoundError") return null; throw e; }
  return <Card title="Подборки" actions={<Link className="btn btn-sm" href="/collections">Все подборки</Link>}><ul className="space-y-2">{result.items.map(c => <li key={c.id}><Link className="link" href={`/collections/${c.id}`}>{c.name}</Link> · {c._count.items} элементов</li>)}</ul>{!result.total && <p className="text-sm text-slate-500">Привязанных доступных подборок нет.</p>}</Card>;
}
