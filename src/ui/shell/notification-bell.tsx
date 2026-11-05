"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { NotificationBrowserDelivery } from "@/modules/notifications/presentation/browser-notifications";

/** Счётчик не мешает работе оболочки при недоступном API. */
export function NotificationBell() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      if (document.hidden) return;
      try {
        const response = await fetch("/api/v1/notifications/unread-count", {
          credentials: "same-origin", cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) { setCount(null); return; }
        const data: unknown = await response.json();
        const value = (data as { count?: unknown } | null)?.count;
        setCount(typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null);
      } catch { if (!controller.signal.aborted) setCount(null); }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    const onRefresh = () => void refresh();
    window.addEventListener("focus", onRefresh);
    window.addEventListener("notifications:changed", onRefresh);
    document.addEventListener("visibilitychange", onRefresh);
    return () => {
      controller.abort(); clearInterval(timer);
      window.removeEventListener("focus", onRefresh);
      window.removeEventListener("notifications:changed", onRefresh);
      document.removeEventListener("visibilitychange", onRefresh);
    };
  }, []);
  return (
    <><NotificationBrowserDelivery /><Link href="/notifications" className="btn icon-button relative" title="Уведомления"
      aria-label={count ? `Уведомления: ${count} непрочитанных` : "Уведомления"}>
      <Bell size={18} aria-hidden="true" />
      {count !== null && count > 0 ? <span className="notification-count" aria-hidden="true">{count > 99 ? "99+" : count}</span> : null}
    </Link></>
  );
}
