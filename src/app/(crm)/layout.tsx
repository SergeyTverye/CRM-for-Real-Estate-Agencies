import Link from "next/link";
import { redirect } from "next/navigation";
import { getPageActor } from "@/server/page-auth";
import { labelOf } from "@/shared/codebook";
import { getConfig } from "@/shared/config/env";
import { CrmShell } from "@/ui/shell/sidebar";
import { NotificationBell } from "@/ui/shell/notification-bell";
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
    <CrmShell isManager={actor.role === "manager"} readOnly={cfg.isReadOnlyInstance} header={
      <>
          <GlobalSearch />
          {cfg.SCRAPER_DEMO_FIXTURES && <span className="badge badge-yellow" title="Синтетические данные и записанные ответы площадок; живой сбор не выполняется">DEMO</span>}
          <div className="shell-actions ml-auto flex items-center gap-2">
            <Link
              href="/tasks?view=overdue"
              className={`overdue-indicator badge ${indicators.overdue > 0 ? "badge-red" : "badge-gray"}`}
              title="Просроченные действия"
            >
              Просрочено: {indicators.overdue}
            </Link>
            <NotificationBell />
            <CreateMenu />
            <UserMenu displayName={actor.displayName} roleLabel={labelOf("userRole", actor.role)} />
          </div>
      </>
    }>
      {children}
    </CrmShell>
  );
}
