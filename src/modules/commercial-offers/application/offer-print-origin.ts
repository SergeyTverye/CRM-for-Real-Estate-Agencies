import { desktopLoopbackAllowed } from "@/shared/auth/desktop-loopback";
import { ForbiddenError } from "@/shared/errors";

/** Next may normalize nextUrl to an internal origin; desktop links use only its trusted binding. */
export function offerPrintOrigin(
  request: { nextUrl: { origin: string }; headers: Headers; method: string },
  env: Record<string, string | undefined> = process.env,
): string {
  if (env.CRM_DEPLOYMENT_MODE !== "desktop") return request.nextUrl.origin;
  if (!desktopLoopbackAllowed(request.headers, request.method, env)) {
    throw new ForbiddenError("Источник запроса не разрешён");
  }
  return `http://127.0.0.1:${env.CRM_DESKTOP_PORT}`;
}
