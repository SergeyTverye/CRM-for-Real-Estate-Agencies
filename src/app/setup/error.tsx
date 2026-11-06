"use client";
export default function SetupError({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-xl space-y-4 p-8"><h1>Не удалось открыть мастер</h1><p>Проверьте локальный сервер и журнал в %LOCALAPPDATA%\\RealEstateCRM\\logs. Введённые пароли в журнал не записываются.</p><button onClick={reset} className="rounded border px-4 py-2">Повторить</button></main>;
}
