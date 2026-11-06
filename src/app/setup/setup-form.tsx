"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useUnsavedChangesWarning } from "@/ui/hooks";
export function SetupForm({ dataDirectory }: { dataDirectory: string }) {
  const router = useRouter();
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useUnsavedChangesWarning(dirty);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setPending(true); setError("");
    const data = new FormData(e.currentTarget);
    try {
      const response = await fetch("/api/v1/desktop/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: data.get("login"), displayName: data.get("displayName"), password: data.get("password"), mode: data.get("mode"), dataDirectory: "default", localDiskConfirmed: data.get("localDiskConfirmed") === "on" }) });
      const result = await response.json();
      if (!response.ok) { setError(result.error?.message ?? "Не удалось завершить настройку"); return; }
      setDirty(false); router.replace("/login?setup=complete");
    } catch { setError("Сервер недоступен. Данные сохранены в форме; повторите попытку."); }
    finally { setPending(false); }
  }
  return <form onSubmit={submit} onChange={() => setDirty(true)} className="space-y-4">
    <label className="block">Имя руководителя<input name="displayName" required maxLength={120} className="block w-full rounded border p-2" autoComplete="name" /></label>
    <label className="block">Логин<input name="login" required pattern="[a-zA-Z0-9._-]{3,50}" className="block w-full rounded border p-2" autoComplete="username" /></label>
    <label className="block">Пароль (от 10 символов, буквы и цифры)<input name="password" type="password" required minLength={10} maxLength={200} className="block w-full rounded border p-2" autoComplete="new-password" /></label>
    <label className="block">Начальные данные<select name="mode" className="block w-full rounded border p-2"><option value="empty">Пустая база</option><option value="demo">Демонстрационные данные</option></select></label>
    <fieldset><legend>Каталог данных</legend><label><input type="radio" name="directory" defaultChecked /> Рекомендуемый локальный каталог</label><p className="break-all text-sm">{dataDirectory}</p></fieldset>
    <p>Не размещайте SQLite в OneDrive, Яндекс.Диске, Облаке Mail.ru или сетевой папке. Для переноса используйте резервные копии.</p>
    <label className="block"><input name="localDiskConfirmed" type="checkbox" required /> Подтверждаю хранение базы на локальном диске</label>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <button disabled={pending} className="rounded bg-blue-700 px-4 py-2 text-white">{pending ? "Создание базы…" : "Создать и перейти ко входу"}</button>
  </form>;
}
