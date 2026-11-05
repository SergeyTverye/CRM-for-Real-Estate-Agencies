"use client";
import { useRef } from "react";

export function PrintPreview({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  return <><button type="button" className="btn" onClick={() => frame.current?.contentWindow?.print()}>Печать A4</button>
    <iframe ref={frame} title="Печатное коммерческое предложение A4" srcDoc={html} sandbox="allow-same-origin allow-modals" className="mt-4 h-[80vh] w-full rounded-md border border-slate-200 bg-white" /></>;
}
