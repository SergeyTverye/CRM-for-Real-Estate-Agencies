"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <div role="alert" className="card p-6">Не удалось загрузить подборки. <button className="btn" onClick={reset}>Повторить</button></div>; }
