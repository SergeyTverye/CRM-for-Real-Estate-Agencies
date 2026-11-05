"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <div role="alert">Не удалось загрузить шаблоны. <button className="btn" onClick={reset}>Повторить</button></div>; }
