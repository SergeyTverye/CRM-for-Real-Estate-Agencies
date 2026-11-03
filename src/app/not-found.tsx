import Link from "next/link";

export const metadata = { title: "Не найдено" };

/** Запись не найдена или недоступна — формулировка не раскрывает существование чужих записей. */
export default function NotFound() {
  return (
    <main className="mx-auto mt-24 max-w-md text-center">
      <h1 className="text-xl font-semibold">Запись не найдена или недоступна</h1>
      <p className="muted mt-2">Проверьте ссылку или вернитесь к рабочему экрану.</p>
      <Link href="/today" className="btn mt-6">
        Вернуться к «Сегодня»
      </Link>
    </main>
  );
}
