"use client";

import { EntityPicker } from "../client-kit";



export interface ClientPick {
  id: string;
  displayName: string;
  contacts: { rawValue: string }[];
}

export interface PropertyPick {
  id: string;
  addressText: string;
  price: string | null;
  responsible: { id: string; displayName: string } | null;
}

export function ClientPicker({ value, onChange, invalid, placeholder }: { value: ClientPick | null; onChange: (v: ClientPick | null) => void; invalid?: boolean; placeholder?: string }) {
  return (
    <EntityPicker<ClientPick>
      url="/api/v1/clients/pick"
      value={value}
      onChange={onChange}
      invalid={invalid}
      placeholder={placeholder ?? "Имя, телефон или e-mail клиента…"}
      render={(c) => (
        <span>
          <span className="font-medium">{c.displayName}</span>
          {c.contacts[0] ? <span className="ml-2 text-xs text-slate-500">{c.contacts[0].rawValue}</span> : null}
        </span>
      )}
    />
  );
}

const money = (v: string | null) => (v ? `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(v))} ₽` : null);

export function PropertyPicker({ value, onChange, invalid }: { value: PropertyPick | null; onChange: (v: PropertyPick | null) => void; invalid?: boolean }) {
  return (
    <EntityPicker<PropertyPick>
      url="/api/v1/properties/pick"
      value={value}
      onChange={onChange}
      invalid={invalid}
      placeholder="Адрес объекта, о котором звонят…"
      render={(p) => (
        <span>
          <span className="font-medium">{p.addressText}</span>
          {money(p.price) ? <span className="ml-2 text-xs text-slate-500">{money(p.price)}</span> : null}
          {p.responsible ? <span className="ml-2 text-xs text-slate-500">· {p.responsible.displayName}</span> : null}
        </span>
      )}
    />
  );
}
