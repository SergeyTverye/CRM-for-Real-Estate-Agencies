"use client";
import Link from "next/link";
import { useState } from "react";
import { Modal } from "../client-kit";
import "./mobile.css";

export function MobileActions({ readOnly }: { readOnly: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <nav className="mobile-action-bar" aria-label="Быстрые действия">
      <Link href="/today" className="btn">Сегодня</Link>
      {!readOnly && <button type="button" className="btn btn-primary" aria-haspopup="dialog" onClick={() => setOpen(true)}>+ Создать</button>}
      <Link href="/tasks" className="btn">Задачи</Link>
    </nav>
    <Modal open={open} onClose={() => setOpen(false)} title="Создать запись">
      <div className="grid gap-3">{([["/requests/new", "Обращение"], ["/clients/new", "Клиента"], ["/tasks/new", "Задачу"], ["/properties/new", "Объект"]] as const).map(([href, label]) =>
        <Link key={href} className="btn justify-start" href={href} onClick={() => setOpen(false)}>{label}</Link>)}</div>
    </Modal>
  </>;
}
