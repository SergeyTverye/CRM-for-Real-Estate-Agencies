"use client";

import { useEffect, useId, useRef } from "react";
import { createRoot } from "react-dom/client";

/** Accessible confirmation; Cancel and Escape never execute the action. */
export function ConfirmDialog({ open, message, title = "Подтверждение действия", confirmLabel = "Подтвердить", onConfirm, onCancel }: {
  open: boolean; message: string; title?: string; confirmLabel?: string; onConfirm: () => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} className="crm-dialog w-[min(480px,95vw)]" aria-labelledby={`${id}-title`} aria-describedby={`${id}-message`}
    onCancel={e => { e.preventDefault(); onCancel(); }}>
    <div className="card-header"><h2 id={`${id}-title`} className="card-title">{title}</h2></div>
    <div className="card-body"><p id={`${id}-message`}>{message}</p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button autoFocus type="button" className="btn" onClick={onCancel}>Отмена</button>
        <button type="button" className="btn btn-primary" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  </dialog>;
}

let active = false;
/** Promise API for existing async commands, also works above an already open Modal. */
export function requestConfirmation(message: string): Promise<boolean> {
  if (active) return Promise.resolve(false);
  active = true;
  const focus = document.activeElement;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  return new Promise(resolve => {
    function finish(accepted: boolean) {
      root.unmount(); host.remove(); active = false;
      if (focus instanceof HTMLElement && focus.isConnected) focus.focus();
      resolve(accepted);
    }
    root.render(<ConfirmDialog open message={message} onConfirm={() => finish(true)} onCancel={() => finish(false)} />);
  });
}
