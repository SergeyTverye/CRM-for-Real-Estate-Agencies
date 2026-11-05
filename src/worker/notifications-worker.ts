import "dotenv/config";
import { setTimeout } from "node:timers/promises";
import { generateNotifications, stopNotificationWorker } from "@/modules/notifications/application/notification-generator";
import { logger } from "@/shared/logging/logger";

let stopping = false;
const abort = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { stopping = true; abort.abort(); });
const interval = Math.max(1000, Math.min(60000, Number(process.env.NOTIFICATIONS_INTERVAL_MS) || 15000));
async function main() {
  while (!stopping) {
    try {
      const result = await generateNotifications();
      if (result.delivered) logger.info({ event: "notifications.delivered", count: result.delivered }, "Notifications delivered");
    } catch {
      // Never log source text, connection strings, tokens or PII in a worker exception.
      logger.error({ event: "notifications.tick_failed" }, "Notification tick failed; retrying");
    }
    if (!stopping) await setTimeout(interval, undefined, { signal: abort.signal }).catch(() => undefined);
  }
  await stopNotificationWorker();
}
void main();
