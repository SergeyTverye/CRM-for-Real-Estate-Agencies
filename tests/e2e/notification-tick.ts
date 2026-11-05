import { generateNotifications, stopNotificationWorker } from "../../src/modules/notifications/application/notification-generator";

async function main() {
  if (new URL(process.env.DATABASE_URL!).pathname !== "/crm_e2e") throw new Error("Requires crm_e2e");
  try { await generateNotifications(); } finally { await stopNotificationWorker(); }
}
void main();
