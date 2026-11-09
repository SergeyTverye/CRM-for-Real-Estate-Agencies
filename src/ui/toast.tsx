"use client";

import { useEffect, useRef, useState } from "react";
import { CircleCheck, CircleAlert, X } from "lucide-react";

type ToastMessage = { message: string; tone: "success" | "error" };
export function toast(message: string, tone: ToastMessage["tone"] = "success") {
  window.dispatchEvent(new CustomEvent<ToastMessage>("crm:toast", { detail: { message, tone } }));
}

/** Один live-region на оболочку. ошибки также остаются рядом с формой. */
export function ToastViewport() {
  const [messages, setMessages] = useState<(ToastMessage & { id: number })[]>([]);
  const sequence = useRef(0);
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<ToastMessage>).detail;
      const id = ++sequence.current;
      setMessages((items) => [...items.slice(-2), { ...detail, id }]);
      const timer = setTimeout(() => {
        setMessages((items) => items.filter((item) => item.id !== id));
        timers.delete(timer);
      }, detail.tone === "error" ? 10_000 : 5_000);
      timers.add(timer);
    };
    window.addEventListener("crm:toast", receive);
    return () => { window.removeEventListener("crm:toast", receive); timers.forEach(clearTimeout); };
  }, []);
  return (
    <div className="toast-viewport" aria-label="Результаты действий">
      {messages.map((item) => (
        <div key={item.id} className={`toast alert alert-${item.tone}`} role={item.tone === "error" ? "alert" : "status"}>
          {item.tone === "error" ? <CircleAlert size={18} aria-hidden="true" /> : <CircleCheck size={18} aria-hidden="true" />}
          <span className="min-w-0 flex-1">{item.message}</span>
          <button type="button" className="icon-button shrink-0 rounded" aria-label="Закрыть уведомление"
            onClick={() => setMessages((items) => items.filter((i) => i.id !== item.id))}><X size={16} aria-hidden="true" /></button>
        </div>
      ))}
    </div>
  );
}
