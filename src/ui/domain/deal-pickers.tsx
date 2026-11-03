"use client";

import { useState } from "react";
import { labelOf } from "@/shared/codebook";
import { EntityPicker } from "../client-kit";
import type { PropertyPick } from "./need-pickers";
import { moneyText, needTitle, type NeedLabels, type NeedPick } from "./deal-form-values";

/**
 * Выбор потребности и объекта для форм показов, КП, сделок, договоров и рекламы.
 * Потребности ищутся через GET /api/v1/needs (серверные права: needScope), объекты — /api/v1/properties/pick.
 */

export type { PropertyPick };
export type { NeedLabels, NeedPick };

export function NeedPicker({
  value,
  onChange,
  labels,
  invalid,
}: {
  value: NeedPick | null;
  onChange: (v: NeedPick | null) => void;
  labels: NeedLabels;
  invalid?: boolean;
}) {
  return (
    <EntityPicker<NeedPick>
      url="/api/v1/needs?status=open&pageSize=20"
      value={value}
      onChange={onChange}
      invalid={invalid}
      placeholder="Имя клиента или район потребности…"
      render={(n) => (
        <span>
          <span className="font-medium">{needTitle(n, labels)}</span>
          <span className="ml-2 text-xs text-slate-500">
            {labelOf("needStage", n.stage)}
            {n.district ? ` · ${n.district}` : ""}
            {n.status === "paused" ? " · на паузе" : ""}
          </span>
        </span>
      )}
    />
  );
}

export function PropertySelect({ value, onChange, invalid, placeholder }: { value: PropertyPick | null; onChange: (v: PropertyPick | null) => void; invalid?: boolean; placeholder?: string }) {
  return (
    <EntityPicker<PropertyPick>
      url="/api/v1/properties/pick"
      value={value}
      onChange={onChange}
      invalid={invalid}
      placeholder={placeholder ?? "Адрес объекта…"}
      render={(p) => (
        <span>
          <span className="font-medium">{p.addressText}</span>
          {p.price ? <span className="ml-2 text-xs text-slate-500">{moneyText(p.price)}</span> : null}
          {p.responsible ? <span className="ml-2 text-xs text-slate-500">· {p.responsible.displayName}</span> : null}
        </span>
      )}
    />
  );
}

/** Выбор объекта внутри GET-формы фильтров: значение уходит скрытым полем. */
export function PropertyFilterPicker({ name = "propertyId", initial }: { name?: string; initial: PropertyPick | null }) {
  const [value, setValue] = useState<PropertyPick | null>(initial);
  return (
    <>
      <input type="hidden" name={name} value={value?.id ?? ""} />
      <PropertySelect value={value} onChange={setValue} placeholder="Любой объект" />
    </>
  );
}
