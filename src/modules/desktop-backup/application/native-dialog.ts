import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { InfrastructureError, ValidationError } from "@/shared/errors";
import { backupRuntimeRoot } from "../infrastructure/destinations-runtime";
import { protectedDir, regularFile } from "../infrastructure/fs";
export const nativeDialogRoot = () => path.join(backupRuntimeRoot(), "native-dialogs");
export async function requestNativeDialog(kind: "folder" | "export", backupId?: string) {
  if (process.env.CRM_DEPLOYMENT_MODE !== "desktop" || process.env.CRM_DESKTOP_SUPERVISED_UPGRADE !== "1") throw new InfrastructureError("Системный диалог доступен в установленной desktop-версии");
  const id = randomUUID(); await protectedDir(nativeDialogRoot());
  await writeFile(path.join(nativeDialogRoot(), id + ".request.json"), JSON.stringify({ kind, backupId, createdAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
  return { requestId: id };
}
export async function readNativeDialog(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new ValidationError();
  const root = nativeDialogRoot();
  try {
    await regularFile(path.join(root, id + ".result.json"));
    const result = JSON.parse(await readFile(path.join(root, id + ".result.json"), "utf8"));
    return { status: result.status as string, directory: result.directory as string | undefined };
  } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return { status: "pending" }; throw new InfrastructureError("Системный диалог недоступен"); }
}
