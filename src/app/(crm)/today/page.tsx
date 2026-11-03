import { requirePageActor } from "@/server/page-auth";

export const metadata = { title: "Сегодня" };

export default async function TodayPage() {
  const actor = await requirePageActor();
  return (
    <div>
      <h1 className="text-xl font-semibold">Сегодня</h1>
      <p className="muted">Здравствуйте, {actor.displayName}.</p>
    </div>
  );
}
