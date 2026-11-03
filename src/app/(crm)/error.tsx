"use client";

import { useEffect } from "react";

/** Ошибка сервера при загрузке страницы: без технических подробностей, с кодом для журнала. */
export default function CrmError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto mt-16 max-w-lg text-center">
      <h1 className="text-lg font-semibold">Не удалось загрузить страницу</h1>
      <p className="muted mt-2 text-sm">Произошла внутренняя ошибка. Повторите попытку; если ошибка повторяется — сообщите руководителю.</p>
      {error.digest ? <p className="mt-2 text-xs text-slate-400">Код ошибки: {error.digest}</p> : null}
      <div className="mt-5 flex justify-center gap-2">
        <button type="button" className="btn btn-primary" onClick={() => reset()}>
          Повторить
        </button>
        <a href="/today" className="btn">
          На «Сегодня»
        </a>
      </div>
    </div>
  );
}
