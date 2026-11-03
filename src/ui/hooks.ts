"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiCallError, type ApiErrorBody } from "./api-client";

/** Выполнение API-действия с состояниями pending/error и обработкой 401/смены пароля. */
export function useApiAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorBody | null>(null);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      setPending(true);
      setError(null);
      try {
        return await fn();
      } catch (e) {
        if (e instanceof ApiCallError) {
          if (e.status === 401 && e.body.code === "UNAUTHENTICATED") {
            router.push("/login");
            return undefined;
          }
          if (e.body.code === "PASSWORD_CHANGE_REQUIRED") {
            router.push("/change-password");
            return undefined;
          }
          setError(e.body);
        } else {
          setError({ code: "CLIENT_ERROR", message: "Непредвиденная ошибка интерфейса" });
        }
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [router],
  );

  const fieldError = useCallback((name: string) => error?.fieldErrors?.[name]?.join("; "), [error]);

  return { pending, error, setError, run, fieldError };
}

/** Предупреждение при уходе со страницы с несохранёнными изменениями (ТЗ 37.17). */
export function useUnsavedChangesWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}
