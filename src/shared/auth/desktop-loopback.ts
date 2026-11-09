export function desktopLoopbackAllowed(headers: Headers, method: string, env: Record<string, string | undefined> = process.env): boolean {
  if (env.CRM_DEPLOYMENT_MODE !== "desktop") return true;
  const port = env.CRM_DESKTOP_PORT;
  if (!port || !/^\d{1,5}$/.test(port) || +port < 1 || +port > 65535) return false;
  const host = `127.0.0.1:${port}`;
  if (headers.get("host") !== host) return false;
  const origin = headers.get("origin");
  if (origin !== null && origin !== `http://${host}`) return false;
  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()) && origin !== `http://${host}`) return false;
  const forwarded = headers.get("x-forwarded-host");
  if (forwarded && forwarded !== host) return false;
  const site = headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}
