"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { apiCall } from "@/ui/api-client";
let audio: AudioContext | null = null;
const key = "crm:browser-reminders:v31";
function subscribe(callback: () => void) { window.addEventListener("storage", callback); window.addEventListener("reminders:preferences", callback); return () => { window.removeEventListener("storage", callback); window.removeEventListener("reminders:preferences", callback); }; }
function snapshot() { try { return localStorage.getItem(key) ?? "off"; } catch { return "off"; } }
function usePreference() { return useSyncExternalStore(subscribe, snapshot, () => "off"); }
function setPreference(value: string) { try { localStorage.setItem(key,value); } catch { /* In-memory event still leaves reminders disabled when storage is blocked. */ } window.dispatchEvent(new Event("reminders:preferences")); }
export function BrowserNotificationControls() {
  const preference = usePreference(), [notice, setNotice] = useState("");
  return <div className="flex flex-wrap items-center gap-2 text-sm"><label><input type="checkbox" checked={preference !== "off"} onChange={e => {
    if (e.target.checked) { audio ??= new AudioContext(); void audio.resume().catch(() => undefined); setPreference("sound"); } else setPreference("off");
  }} /> Звук напоминаний</label><button type="button" className="btn btn-sm" onClick={async () => {
    if (!("Notification" in window)) { setNotice("Браузер не поддерживает системные уведомления"); return; }
    const permission = await Notification.requestPermission();
    if (permission === "granted") { setPreference("system"); setNotice("Системные уведомления включены при открытой вкладке"); } else setNotice("Разрешение не получено. Напоминания доступны в CRM.");
  }}>Разрешить уведомления браузера</button><span role="status">{notice}</span></div>;
}
export function NotificationBrowserDelivery() {
  const preference = usePreference();
  useEffect(() => {
    if (preference === "off") return;
    let stopped = false, running = false;
    async function tick() {
      if (stopped || running || document.hidden) return; running = true;
      try {
        const result = await apiCall<{ items: { id: string; title: string; detail: string; link: string; triggerAt: string; snoozedUntil: string | null; readAt: string | null }[] }>("GET", "/api/v1/notifications?state=delivered&pageSize=20");
        if (stopped) return;
        const seenKey = `${key}:seen`;
        let seen: string[] = [];
        try { seen = JSON.parse(localStorage.getItem(seenKey) ?? "[]") as string[]; } catch { /* no stored IDs */ }
        const fresh = result.items.filter(n => !n.readAt && !seen.includes(`${n.id}:${n.snoozedUntil ?? n.triggerAt}`));
        for (const n of fresh.slice(0,5)) {
          if (preference === "system" && "Notification" in window && Notification.permission === "granted") {
            const notification = new Notification(n.title, { body: n.detail, tag: n.id });
            notification.onclick = () => { window.focus(); window.location.assign(n.link); notification.close(); };
          }
        }
        if (fresh.length && audio?.state === "running") { const osc = audio.createOscillator(), gain = audio.createGain(); osc.connect(gain); gain.connect(audio.destination); gain.gain.value = 0.05; osc.frequency.value = 660; osc.start(); osc.stop(audio.currentTime+0.15); }
        seen = [...new Set([...seen, ...fresh.map(n => `${n.id}:${n.snoozedUntil ?? n.triggerAt}`)])].slice(-1000);
        try { localStorage.setItem(seenKey,JSON.stringify(seen)); } catch { /* browser may block storage */ }
      } catch { /* Regular CRM notifications remain available when polling fails. */ }
      finally { running = false; }
    }
    void tick(); const timer = setInterval(() => void tick(),30000);
    document.addEventListener("visibilitychange",tick);
    return () => { stopped = true; clearInterval(timer); document.removeEventListener("visibilitychange",tick); };
  },[preference]);
  return null;
}
