"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import { apiCall } from "@/ui/api-client";


export function CatalogPhoto({ propertyId, address }: { propertyId: string; address: string | null }) {
  const [photo, setPhoto] = useState<{ thumbnailUrl: string } | null>(null);
  useEffect(() => {
    let active = true;
    void apiCall<{ items: { kind: string; isCover: boolean; thumbnailUrl: string }[] }>("GET", `/api/v1/properties/${propertyId}/media`)
      .then(({ items }) => { if (active) setPhoto(items.find(item => item.kind === "photo" && item.isCover) ?? items.find(item => item.kind === "photo") ?? null); })
      .catch(() => { if (active) setPhoto(null); });
    return () => { active = false; };
  }, [propertyId]);
  return photo ? <Image unoptimized src={photo.thumbnailUrl} alt={`Фото каталога CRM: ${address ?? "Объект"}`} width={240} height={160} className="max-h-40 rounded object-contain" /> : null;
}
