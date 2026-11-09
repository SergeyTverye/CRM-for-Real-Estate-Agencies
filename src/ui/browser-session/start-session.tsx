"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiCall, ApiCallError, type ApiErrorBody } from "@/ui/api-client";
import { FormErrorBanner } from "@/ui/form";
import type { SessionSource } from "@/modules/browser-sessions/domain/session";

export function StartBrowserSession({ searchRunId, source }: { searchRunId: string; source: SessionSource }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [error, setError] = useState<ApiErrorBody | null>(null);
  async function start() {
    setBusy(true); setError(null);
    try { const session = await apiCall<{ id: string }>("POST", "/api/v1/browser-sessions", { searchRunId, source }); router.push(`/browser-sessions/${session.id}`); }
    catch (e) { setError(e instanceof ApiCallError ? e.body : { code: "SESSION_FAILED", message: "Не удалось открыть сеанс" }); }
    finally { setBusy(false); }
  };
  const existing = error?.details?.sessionUrl;
  return <div><button className="btn btn-secondary" disabled={busy} onClick={() => void start()}>{busy ? "Открываем площадку…" : "Пройти проверку в браузере CRM"}</button><FormErrorBanner error={error} />
    {typeof existing === "string" && /^\/browser-sessions\/[0-9a-f-]{36}$/iu.test(existing) ? <Link href={existing} className="btn btn-secondary">Вернуться к открытому сеансу</Link> : null}</div>;
}
