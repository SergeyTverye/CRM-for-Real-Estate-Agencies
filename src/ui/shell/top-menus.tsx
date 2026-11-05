"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CREATE_ITEMS } from "./nav-config";
import { apiCall } from "../api-client";

function useClickOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && ref.current?.contains(document.activeElement)) {
        onOutside();
        ref.current.querySelector("button")?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", handler);
    return () => { document.removeEventListener("mousedown", handler); document.removeEventListener("keydown", onKey); };
  }, [onOutside]);
  return ref;
}

export function CreateMenu() {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="btn btn-primary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        + Создать
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-48 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {CREATE_ITEMS.map((i) => (
            <Link key={i.href} href={i.href} className="block px-3 py-1.5 text-sm hover:bg-slate-50" onClick={() => setOpen(false)}>
              {i.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function UserMenu({ displayName, roleLabel }: { displayName: string; roleLabel: string }) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  const router = useRouter();
  async function logout() {
    await apiCall("POST", "/api/v1/auth/logout").catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="user-menu-name max-w-40 truncate">{displayName}</span>
        <span className="user-menu-role text-xs text-slate-500">{roleLabel}</span>
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-48 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          <Link href="/change-password" className="block px-3 py-1.5 text-sm hover:bg-slate-50">
            Сменить пароль
          </Link>
          <button type="button" className="block w-full px-3 py-1.5 text-left text-sm text-red-700 hover:bg-red-50" onClick={logout}>
            Выйти
          </button>
        </div>
      ) : null}
    </div>
  );
}
