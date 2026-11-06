import { requirePageActor } from "@/server/page-auth";
import { BackupPanel } from "./backup-panel";
export default async function BackupSettingsPage() {
  await requirePageActor({ manager: true });
  return <BackupPanel />;
}
