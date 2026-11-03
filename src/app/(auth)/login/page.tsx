import { redirect } from "next/navigation";
import { getPageActor } from "@/server/page-auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Вход" };

export default async function LoginPage() {
  const actor = await getPageActor();
  if (actor) redirect(actor.mustChangePassword ? "/change-password" : "/today");
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="card w-full max-w-sm">
        <div className="card-body space-y-5">
          <div>
            <h1 className="text-lg font-semibold">CRM «Магазин недвижимости»</h1>
            <p className="muted text-sm">Вход для сотрудников агентства</p>
          </div>
          <LoginForm />
          <p className="text-xs text-slate-400">Учётные записи создаёт руководитель. Если вы забыли пароль — обратитесь к руководителю.</p>
        </div>
      </div>
    </main>
  );
}
