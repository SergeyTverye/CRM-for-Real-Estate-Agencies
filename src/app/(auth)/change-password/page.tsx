import { requirePageActor } from "@/server/page-auth";
import { ChangePasswordForm } from "./change-password-form";

export const metadata = { title: "Смена пароля" };

export default async function ChangePasswordPage() {
  const actor = await requirePageActor({ allowPasswordChange: true });
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="card w-full max-w-sm">
        <div className="card-body space-y-5">
          <div>
            <h1 className="text-lg font-semibold">Смена пароля</h1>
            <p className="muted text-sm">{actor.displayName}</p>
          </div>
          <ChangePasswordForm forced={actor.mustChangePassword} />
        </div>
      </div>
    </main>
  );
}
