import Link from "next/link";
import { redirect } from "next/navigation";
import { getPageActor } from "@/server/page-auth";
import { labelOf } from "@/shared/codebook";
import { getConfig } from "@/shared/config/env";
import { Sidebar } from "@/ui/shell/sidebar";
import { CreateMenu, UserMenu } from "@/ui/shell/top-menus";
import { GlobalSearch } from "@/ui/shell/global-search";
import { getShellIndicators } from "@/server/shell-indicators";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const actor = await getPageActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  const cfg = getConfig();
  const indicators = await getShellIndicators(actor);
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col bg-slate-900">
        <Link href="/today" className="block px-4 py-3 text-sm font-semibold text-white">
          Магазин недвижимости
          <span className="block text-xs font-normal text-slate-400">CRM</span>
        </Link>
        <div className="flex-1 overflow-y-auto">
          <Sidebar isManager={actor.role === "manager"} />
        </div>
        {cfg.isReadOnlyInstance ? (
          <div className="m-2 rounded bg-amber-500 px-2 py-1 text-xs font-medium text-black">Standby: только чтение</div>
        ) : null}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/tasks?view=overdue"
              className={`badge ${indicators.overdue > 0 ? "badge-red" : "badge-gray"}`}
              title="Просроченные действия"
            >
              Просрочено: {indicators.overdue}
            </Link>
            <CreateMenu />
            <UserMenu displayName={actor.displayName} roleLabel={labelOf("userRole", actor.role)} />
          </div>
        </header>
        <main className="min-w-0 flex-1 p-5">{children}</main>
      </div>
    </div>
  );
}
