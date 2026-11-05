"use client";

/* eslint-disable @next/next/no-img-element -- authenticated thumbnails must bypass the public image optimizer */
import { useEffect, useState } from "react";
import { apiCall } from "@/ui/api-client";

type Photo = { kind: string; archived: boolean; isCover: boolean; thumbnailUrl: string; caption: string | null; name: string };

/** Only user-uploaded CRM photos are reusable. Source image URLs do not establish usage rights. */
export function ListingPhoto({ propertyId, sourceUrl }: { propertyId: string | null; sourceUrl: string }) {
  const [preview, setPreview] = useState<{ propertyId: string; photo: Photo | null } | null>(null);
  useEffect(() => {
    if (!propertyId) return;
    let active = true;
    void apiCall<{ items: Photo[] }>("GET", `/api/v1/properties/${propertyId}/media`).then(({ items }) => {
      const photos = items.filter(p => p.kind === "photo" && !p.archived);
      if (active) setPreview({ propertyId, photo: photos.find(p => p.isCover) ?? photos[0] ?? null });
    }).catch(() => { if (active) setPreview({ propertyId, photo: null }); });
    return () => { active = false; };
  }, [propertyId]);
  const photo = preview?.propertyId === propertyId ? preview?.photo : null;
  return <div className="mb-3">
    {propertyId && preview?.propertyId !== propertyId ? <p className="text-xs text-slate-500" role="status">Загрузка фотографии…</p> : photo ?
      <figure><img src={photo.thumbnailUrl} alt={`Фото каталога CRM: ${photo.caption ?? photo.name}`} className="mb-1 h-44 w-full rounded object-contain"
        onError={() => setPreview({ propertyId: propertyId!, photo: null })} /><figcaption className="text-xs text-slate-500">Фото каталога CRM{photo.caption ? ` · ${photo.caption}` : ""}</figcaption></figure> :
      <a className="link text-xs" href={sourceUrl} target="_blank" rel="noopener noreferrer">Фотографии у первоисточника ↗</a>}
  </div>;
}
