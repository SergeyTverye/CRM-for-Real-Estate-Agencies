"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Native disclosure keeps inputs mounted, including uncontrolled values and picker state. */
export function DisclosureSection({ title, hint, children, defaultOpen = false, error }: {
  title: string;
  hint?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  error?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (error && ref.current) ref.current.open = true;
  }, [error]);
  return (
    <details ref={ref} open={defaultOpen || Boolean(error) || undefined}
      className="rounded-md border border-slate-200 bg-white p-3"
      onInvalidCapture={() => { if (ref.current) ref.current.open = true; }}>
      <summary className="cursor-pointer rounded text-sm font-semibold text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600">
        {title}
        {error ? <span className="ml-2 text-xs font-normal text-red-700">Проверьте поля в этом разделе</span> : null}
      </summary>
      {hint ? <p className="mt-2 text-xs text-slate-500">{hint}</p> : null}
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}
