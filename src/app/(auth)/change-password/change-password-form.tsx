"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "@/ui/api-client";
import { useApiAction } from "@/ui/hooks";
import { Field, FormErrorBanner } from "@/ui/form";

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter();
  const { pending, error, run, fieldError, setError } = useApiAction();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [repeat, setRepeat] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== repeat) {
      setError({ code: "VALIDATION_ERROR", message: "Пароли не совпадают", fieldErrors: { repeat: ["Пароли не совпадают"] } });
      return;
    }
    const ok = await run(() => apiCall("POST", "/api/v1/auth/change-password", { currentPassword, newPassword }));
    if (ok) router.replace("/today");
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-4" noValidate>
      {forced ? <div className="alert alert-info">Вам выдан временный пароль. Задайте собственный пароль, чтобы продолжить работу.</div> : null}
      <FormErrorBanner error={error} />
      <Field label={forced ? "Временный пароль" : "Текущий пароль"} error={fieldError("currentPassword")}>
        <input type="password" className="input" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label="Новый пароль" error={fieldError("newPassword")} hint="Не короче 10 символов, буквы и цифры, без логина">
        <input type="password" className="input" autoComplete="new-password" value={newPassword} onChange={(e) => setNew(e.target.value)} />
      </Field>
      <Field label="Повторите новый пароль" error={fieldError("repeat")}>
        <input type="password" className="input" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
      </Field>
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? "Сохранение…" : "Сменить пароль"}
      </button>
    </form>
  );
}
