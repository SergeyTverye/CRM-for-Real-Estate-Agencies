import { z } from "zod";
import { db } from "@/shared/db/client";
import { parseInput, zUuid } from "@/shared/validation";
import type { Actor } from "@/modules/auth/domain/actor";

export async function pickCallContext(_actor: Actor, raw: unknown) {
  const f = parseInput(z.object({ kind: z.enum(["advertisement", "external"]), q: z.string().trim().max(200).default(""), id: zUuid.optional() }), raw);
  if (f.kind === "advertisement") {
    const rows = await db.advertisement.findMany({ where: { ...(f.id ? { id: f.id } : {}), ...(f.q ? { OR: [{ property: { addressText: { contains: f.q, mode: "insensitive" } } }, { adText: { contains: f.q, mode: "insensitive" } }, { platformCode: { contains: f.q, mode: "insensitive" } }] } : {}) }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 20, select: { id: true, platformCode: true, property: { select: { id: true, addressText: true } } } });
    return { items: rows.map(r => ({ id: r.id, label: `${r.platformCode} · ${r.property.addressText}`, propertyId: r.property.id })) };
  }
  const rows = await db.externalListing.findMany({ where: f.q ? { OR: [{ address: { contains: f.q, mode: "insensitive" } }, { source: { contains: f.q, mode: "insensitive" } }] } : {}, orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }], take: 20, select: { id: true, address: true, source: true } });
  return { items: rows.map(r => ({ id: r.id, label: `${r.source} · ${r.address ?? "Адрес не указан"}` })) };
}
