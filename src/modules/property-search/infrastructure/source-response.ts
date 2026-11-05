import { setTimeout as delay } from "node:timers/promises";
import type RealEstateScraper from "real-estate-scrapper";
import type { Source } from "../domain/types";

export type AdapterFailure = "needs_user_action" | "rate_limited" | "blocked" | "parse_failed" | "timeout" | "cancelled";
export function detectAccessChallenge(url: string, payload: unknown): boolean {
  const host = new URL(url).hostname;
  if (!/(?:^|\.)(?:cian|avito|yandex|domclick|onrealt|mirkvartir|youla)\.ru$/u.test(host)) return false;
  if (/\/(?:showcaptcha|captcha|challenge|antibot)(?:\/|\?|$)/iu.test(url)) return true;
  if (payload && typeof payload === "object") {
    const n = payload as Record<string, unknown>;
    return n.captcha === true || typeof n.captchaUrl === "string" || ["CAPTCHA_REQUIRED", "NEEDS_USER_ACTION", "captcha"].includes(String(n.code ?? n.status));
  }
  if (typeof payload !== "string") return false;
  // Inspect challenge UI, not arbitrary mentions of captcha in script bundles.
  return /<(?:title|h1)[^>]*>[^<]*(?:captcha|проверка|подтвердите|доступ ограничен|just a moment|access denied)/iu.test(payload) ||
    /<(?:form|div|iframe)[^>]*(?:action=["'][^"']*captcha|id=["'](?:captcha|challenge-running)|class=["'][^"']*(?:SmartCaptcha|g-recaptcha|h-captcha))/iu.test(payload) ||
    payload.length < 20000 && /(?:подтвердите.{0,40}человек|проверка браузера|CIAN_ACCESS_CHALLENGE)/iu.test(payload);
}
export function retryAfterMs(value: string | undefined, now = Date.now()): number | null {
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/u.test(value.trim())) return Math.max(1000, Math.ceil(Number(value) * 1000));
  if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/iu.test(value.trim())) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(1000, at - now) : null;
}
/** One delayed attempt only. A missing/invalid Retry-After never triggers retries. */
export function resilientTransport(base: RealEstateScraper.Transport, source: Source, deadline: number): RealEstateScraper.Transport {
  let stopped: { code: string; status?: number; url: string } | undefined;
  return async request => {
    if (stopped) throw Object.assign(new Error(stopped.code), stopped);
    let response = await base(request);
    if (typeof response !== "string" && response.status === 429) {
      const wait = retryAfterMs(response.headers?.["retry-after"]);
      if (wait !== null && Date.now() + wait + 1000 < deadline) {
        await delay(wait, undefined, { signal: request.signal });
        response = await base({ ...request, timeout: Math.min(request.timeout, Math.max(1, deadline - Date.now())) });
      }
    }
    const status = typeof response === "string" ? 200 : response.status;
    const data = typeof response === "string" ? response : response.data;
    const responseUrl = typeof response === "string" ? request.url : response.url ?? request.url;
    const code = detectAccessChallenge(responseUrl, data) ? "NEEDS_USER_ACTION" : status === 429 ? "RATE_LIMITED" : [401, 403, 439].includes(status ?? 0) ? "ACCESS_BLOCKED" : undefined;
    if (code) {
      stopped = { code, status, url: `https://${new URL(request.url).hostname}/` };
      throw Object.assign(new Error(`${source}:${code}`), stopped, { response: { status, data: "", headers: {} } });
    }
    return response;
  };
}
