import { notFound, redirect } from "next/navigation";
import { desktopSetupStatus } from "@/modules/desktop-setup/application/setup-service";
import { SetupForm } from "./setup-form";
export const dynamic = "force-dynamic";
export default async function SetupPage() {
  if (process.env.CRM_DEPLOYMENT_MODE !== "desktop") notFound();
  const status = await desktopSetupStatus();
  if (!status.available) redirect("/login");
  return <main className="mx-auto max-w-xl space-y-5 p-8"><h1 className="text-2xl font-semibold">Первый запуск CRM</h1><p>Создайте учётную запись руководителя. Облака можно подключить позже.</p><SetupForm dataDirectory={status.dataDirectory} /><p className="text-sm">Задания и резервные копии работают, пока CRM открыта или свёрнута в трей. После полного выхода они продолжатся при следующем запуске.</p></main>;
}
