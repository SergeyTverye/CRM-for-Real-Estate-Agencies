import Link from "next/link";

export const metadata = { title: "Нет доступа" };

export default function ForbiddenPage() {
  return (
    <main className="mx-auto mt-24 max-w-md text-center">
      <h1 className="text-xl font-semibold">Нет доступа</h1>
      <p className="muted mt-2">Этот раздел доступен только руководителю.</p>
      <Link href="/today" className="btn mt-6">
        Вернуться к «Сегодня»
      </Link>
    </main>
  );
}
