"use client";

import { useId, useImperativeHandle, useRef, useState, type Ref } from "react";

export function FilePicker({ label, accept, multiple, disabled, name, inputRef, onFiles, selectedCount }: {
  label: string; accept?: string; multiple?: boolean; disabled?: boolean; name?: string;
  inputRef?: Ref<HTMLInputElement>; onFiles?: (files: FileList | null) => void; selectedCount?: number;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement | null>(null);
  useImperativeHandle(inputRef, () => input.current!, []);
  const [names, setNames] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const count = selectedCount ?? names.length;
  function choose(files: FileList | null) {
    setNames(Array.from(files ?? []).map(f => f.name));
    onFiles?.(files);
  }
  return <div className={`space-y-2 rounded-md border-2 border-dashed p-3 ${dragging ? "border-brand-600 bg-brand-50" : "border-slate-300"}`}
    onDragOver={e => { e.preventDefault(); if (!disabled) setDragging(true); }}
    onDragLeave={() => setDragging(false)}
    onDrop={e => {
      e.preventDefault(); setDragging(false);
      if (disabled || !input.current) return;
      const transfer = new DataTransfer();
      Array.from(e.dataTransfer.files).slice(0, multiple ? e.dataTransfer.files.length : 1).forEach(f => transfer.items.add(f));
      input.current.files = transfer.files; choose(transfer.files);
    }}>
    <label htmlFor={id} className={`btn relative cursor-pointer focus-within:outline-2 focus-within:outline-brand-600 ${disabled ? "opacity-50" : ""}`}>
      {label}
      <input id={id} ref={input}
        type="file" name={name} accept={accept} multiple={multiple} disabled={disabled} className="sr-only"
        onChange={e => choose(e.target.files)} />
    </label>
    <p className="text-xs text-slate-600">Или перетащите {multiple ? "файлы" : "файл"} сюда</p>
    <p className="text-sm" role="status">{count ? `Выбрано файлов: ${count}` : "Файлы не выбраны"}{!multiple && names[0] ? ` · ${names[0]}` : ""}</p>
  </div>;
}
