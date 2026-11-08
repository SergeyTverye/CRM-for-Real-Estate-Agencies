"use client";

import { useId, useState } from "react";

export interface HelpTooltipProps {
  label: string;
  text: string;
  defaultOpen?: boolean;
}

/**
 * Доступная контекстная подсказка (клавиатура focus/Escape, наведение мыши и нажатие на сенсорном экране).
 * Не полагается только на HTML-атрибут title.
 */
export function HelpTooltip({ label, text, defaultOpen = false }: HelpTooltipProps) {
  const id = useId();
  const tooltipId = `help-tooltip-${id}`;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(defaultOpen);
  const isOpen = pinned || hovered || focused;

  return (
    <span
      className="relative inline-flex items-center align-middle"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={isOpen}
        aria-controls={tooltipId}
        aria-describedby={isOpen ? tooltipId : undefined}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setPinned((current) => !current);
        }}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) {
            setFocused(false);
            setPinned(false);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setHovered(false);
            setFocused(false);
            setPinned(false);
          }
        }}
        className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-xs font-semibold text-slate-700 hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        ?
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        hidden={!isOpen}
        className={`z-30 w-72 rounded border border-slate-300 bg-slate-900 p-2.5 text-left text-xs font-normal leading-relaxed text-white shadow-lg ${
          isOpen ? "absolute left-0 top-full mt-1 block" : "hidden"
        }`}
      >
        {text}
      </span>
    </span>
  );
}
