"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Building2, PanelLeftClose, PanelLeftOpen, Menu, X, Sun, Inbox, Users, ListChecks, House, Search, CalendarDays, Bell, MapPin, CheckSquare, FileText, Handshake, Megaphone, ChartNoAxesCombined, Archive, Upload, Settings, Shield, Sparkles } from "lucide-react";
import { NAV_ITEMS } from "./nav-config";
import { Modal } from "../client-kit";
import { MobileActions } from "./mobile-actions";
import { ToastViewport } from "../toast";

const icons = {
  "/today": Sun, "/requests": Inbox, "/clients": Users, "/needs": ListChecks,
  "/properties": House, "/property-search": Search, "/showings": MapPin,
  "/tasks": CheckSquare, "/calendar": CalendarDays, "/notifications": Bell,
  "/offers": FileText, "/deals": Handshake, "/agreements": FileText,
  "/advertisements": Megaphone, "/reports": ChartNoAxesCombined, "/archive": Archive,
  "/import": Upload, "/operations": Settings, "/admin": Shield, "/settings/sources": Search, "/settings/ai": Sparkles, "/templates": FileText,
};
const storageKey = "crm.sidebar.collapsed";
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("crm:sidebar", callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener("crm:sidebar", callback); };
}
function snapshot() { try { return localStorage.getItem(storageKey) === "true"; } catch { return false; } }

export function Sidebar({ isManager, collapsed = false, onNavigate }: { isManager: boolean; collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((i) => !i.managerOnly || isManager);
  return (
    <nav className="sidebar-nav" aria-label="Основная навигация">
      {items.map((item, idx) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = icons[item.href as keyof typeof icons] ?? House;
        return (
          <div key={item.href}>
            {item.managerOnly && !items[idx - 1]?.managerOnly ? <div className="sidebar-divider" /> : null}
            <Link href={item.href} className={`sidebar-link ${active ? "is-active" : ""}`}
              title={collapsed ? item.label : undefined} aria-label={collapsed ? item.label : undefined}
              aria-current={active ? "page" : undefined} onClick={onNavigate}>
              <Icon size={18} aria-hidden="true" className="shrink-0" />
              <span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>
            </Link>
          </div>
        );
      })}
    </nav>
  );
}

export function CrmShell({ children, header, isManager, readOnly }: { children: React.ReactNode; header: React.ReactNode; isManager: boolean; readOnly: boolean }) {
  const collapsed = useSyncExternalStore(subscribe, snapshot, () => false);
  const [mobileOpen, setMobileOpen] = useState(false);
  
  const [localCollapsed, setLocalCollapsed] = useState<boolean | null>(null);
  const isCollapsed = localCollapsed ?? collapsed;
  function toggle() {
    const value = !isCollapsed;
    try { localStorage.setItem(storageKey, String(value)); window.dispatchEvent(new Event("crm:sidebar")); }
    catch { setLocalCollapsed(value); }
  }
  return (
    <div className={`crm-shell ${isCollapsed ? "sidebar-collapsed" : ""}`}>
      <a className="skip-link" href="#crm-main">Перейти к содержимому</a>
      <aside className="crm-sidebar">
        <Link href="/today" className="sidebar-brand" title="Магазин недвижимости">
          <Building2 size={24} aria-hidden="true" className="shrink-0 text-blue-300" />
          <span className={isCollapsed ? "sr-only" : "min-w-0"}>Магазин недвижимости<span className="block text-xs font-normal text-slate-400">Рабочее пространство</span></span>
        </Link>
        <div className="min-h-0 flex-1 overflow-y-auto"><Sidebar isManager={isManager} collapsed={isCollapsed} /></div>
        {readOnly ? <div className="m-2 rounded bg-amber-100 p-2 text-xs text-amber-900" title="Standby: только чтение">{isCollapsed ? "RO" : "Standby: только чтение"}</div> : null}
        <button type="button" className="sidebar-toggle" onClick={toggle} aria-expanded={!isCollapsed} aria-label={isCollapsed ? "Развернуть навигацию" : "Свернуть навигацию"}>
          {isCollapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <><PanelLeftClose size={18} aria-hidden="true" /><span>Свернуть меню</span></>}
        </button>
      </aside>
      <div className="crm-workspace">
        <header className="crm-header [&>.shell-actions]:max-w-full max-md:[&>.shell-actions]:flex-wrap">
          <button type="button" className="btn icon-button mobile-menu-toggle" aria-label="Открыть навигацию" aria-haspopup="dialog" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu size={20} aria-hidden="true" /></button>
          {header}
        </header>
        <main id="crm-main" tabIndex={-1} className="crm-main">{children}</main>
      </div>
      <Modal open={mobileOpen} onClose={() => setMobileOpen(false)} title="Навигация">
        <div className="mobile-navigation"><Sidebar isManager={isManager} onNavigate={() => setMobileOpen(false)} /></div>
        {readOnly ? <p className="alert alert-warning">Standby: только чтение</p> : null}
        <button type="button" className="btn mt-3 w-full" onClick={() => setMobileOpen(false)}><X size={16} aria-hidden="true" /> Закрыть меню</button>
      </Modal>
      <MobileActions readOnly={readOnly} />
      <ToastViewport />
    </div>
  );
}
