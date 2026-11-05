"use client";

import { useState } from "react";
import { EntityPicker } from "@/ui/client-kit";

export function AdvertisementFilter({ initial }: { initial: { id: string; label: string } | null }) {
  const [value, setValue] = useState(initial);
  return <div className="w-72">
    <input type="hidden" name="advertisementId" value={value?.id ?? ""} />
    <EntityPicker url="/api/v1/requests/pick-context?kind=advertisement" value={value} onChange={setValue} render={ad => ad.label} placeholder="Площадка или адрес рекламы…" />
  </div>;
}
