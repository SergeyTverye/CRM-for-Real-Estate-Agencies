import { requirePageActor } from "@/server/page-auth";
import { listUsers } from "@/modules/users/application/users-service";
import { tz } from "@/server/format";
import { PageHeader } from "@/ui/components";
import { AdminUsersPanel } from "@/ui/domain/admin-users";

export const metadata = { title: "Пользователи" };

export default async function AdminUsersPage() {
  const actor = await requirePageActor({ manager: true });
  const users = await listUsers(actor);
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Пользователи и роли"
        back={{ href: "/admin", label: "Администрирование" }}
        subtitle="Самостоятельной регистрации нет: учётные записи создаёт руководитель. Пользователи не удаляются — только деактивируются."
      />
      <AdminUsersPanel
        currentUserId={actor.userId}
        timeZone={tz()}
        users={users.map((u) => ({
          id: u.id,
          login: u.login,
          displayName: u.displayName,
          roleCode: u.roleCode,
          isActive: u.isActive,
          mustChangePassword: u.mustChangePassword,
          passwordChangedAt: u.passwordChangedAt?.toISOString() ?? null,
          createdAt: u.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
