import Link from "next/link";
import { requirePageActor } from "@/server/page-auth";
import { PageHeader } from "@/ui/components";

export const metadata = { title: "Администрирование" };

const SECTIONS: { href: string; title: string; text: string }[] = [
  { href: "/admin/users", title: "Пользователи и роли", text: "Учётные записи сотрудников, роли, деактивация и восстановление, сброс пароля через временный пароль." },
  { href: "/admin/dictionaries", title: "Справочники", text: "Каналы и источники обращений, типы объектов и операций, рекламные площадки, причины отказа и другие бизнес-справочники." },
  { href: "/admin/legal-entities", title: "Юридические субъекты", text: "ИП и ООО, от имени которых оформляются договоры, сделки и коммерческие предложения." },
  { href: "/admin/audit", title: "Журнал аудита", text: "Критичные изменения: права доступа, ответственные, архивирование, роли, справочники — кто, когда и что изменил." },
  { href: "/import", title: "Импорт данных", text: "Загрузка исторических Excel-файлов: проверка (dry-run), отчёт об ошибках и дублях, подтверждённая загрузка." },
  { href: "/operations", title: "Эксплуатация и резервные копии", text: "Состояние экземпляра, база данных, резервное копирование и проверка копий." },
];

export default async function AdminIndexPage() {
  await requirePageActor({ manager: true });
  return (
    <div className="max-w-5xl">
      <PageHeader title="Администрирование" subtitle="Доступно только руководителю. Критичные изменения подтверждаются и фиксируются в журнале аудита." />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="card block px-4 py-3 hover:border-slate-300 hover:bg-slate-50">
            <div className="font-medium text-brand-700">{s.title}</div>
            <div className="mt-0.5 text-sm text-slate-600">{s.text}</div>
          </Link>
        ))}
      </div>
      <div className="alert alert-info mt-4">
        Доступ риелтора к контактам собственника чужого объекта выдаётся и отзывается в карточке объекта — вкладка «Собственники» (раздел{" "}
        <Link href="/properties" className="link">
          «Объекты»
        </Link>
        ).
      </div>
    </div>
  );
}
