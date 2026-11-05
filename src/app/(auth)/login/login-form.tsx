"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "@/ui/api-client";
import { useApiAction } from "@/ui/hooks";
import { FormErrorBanner } from "@/ui/form";

export function LoginForm() {
  const router = useRouter();
  const { pending, error, run } = useApiAction();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await run(() => apiCall<{ mustChangePassword: boolean }>("POST", "/api/v1/auth/login", { login, password }));
    if (res) router.replace(res.mustChangePassword ? "/change-password" : "/today");
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormErrorBanner error={error} />
      <div>
        <label className="label" htmlFor="login">
          Логин
        </label>
        <input id="login" name="login" className="input" autoComplete="username" autoFocus value={login} onChange={(e) => setLogin(e.target.value)} required />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Пароль
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? "Вход…" : "Войти"}
      </button>
    </form>
  );
}
