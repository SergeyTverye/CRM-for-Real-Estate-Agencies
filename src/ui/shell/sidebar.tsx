"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./nav-config";

export function Sidebar({ isManager }: { isManager: boolean }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((i) => !i.managerOnly || isManager);
  return (
    <nav className="flex flex-col gap-0.5 p-2" aria-label="Основная навигация">
      {items.map((item, idx) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const firstManager = item.managerOnly && !items[idx - 1]?.managerOnly;
        return (
          <div key={item.href}>
            {firstManager ? <div className="mx-2 my-2 border-t border-slate-700/60" /> : null}
            <Link
              href={item.href}
              className={`block rounded-md px-3 py-1.5 text-sm ${active ? "bg-slate-700 font-medium text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"}`}
              aria-current={active ? "page" : undefined}
            >
              {item.label}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
