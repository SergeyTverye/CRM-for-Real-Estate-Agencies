"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <div role="alert"><p>Не удалось загрузить настройки. Проверьте выбранный месяц и доступность сервера.</p><button onClick={reset}>Повторить</button><a href="/settings/ai">Открыть текущий месяц</a></div>;
}
