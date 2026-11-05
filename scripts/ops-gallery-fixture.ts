// Explicit synthetic fixture for the Docker backup/restore smoke. Never resets existing data.
import sharp from "sharp";
import { db, disconnectDb } from "@/shared/db/client";
import { uploadPropertyMedia } from "@/modules/properties/application/property-media-service";
import type { Actor } from "@/modules/auth/domain/actor";

async function main() {
  if (process.env.OPS_SYNTHETIC_FIXTURE !== "true") throw new Error("OPS_SYNTHETIC_FIXTURE=true required");
  const user = await db.user.findFirstOrThrow({ where: { roleCode: "manager", isActive: true } });
  const actor: Actor = { userId: user.id, login: user.login, displayName: user.displayName,
    role: "manager", mustChangePassword: false, sessionId: "ops-synthetic" };
  const addressText = "[ops synthetic] backup gallery control";
  const property = await db.property.findFirst({ where: { addressText } }) ?? await db.property.create({ data: {
    addressText, propertyType: "commercial", operationType: "sale", sourceType: "agency_listing", status: "active",
    responsibleUserId: user.id, createdBy: user.id,
  } });
  const bytes = await sharp({ create: { width: 64, height: 48, channels: 3, background: "blue" } }).jpeg().toBuffer();
  await uploadPropertyMedia(actor, property.id,
    new File([new Uint8Array(bytes)], "ops-synthetic.jpg", { type: "image/jpeg" }), { kind: "photo" });
  const title = "[ops synthetic] notification restart control";
  if (!await db.task.findFirst({ where: { title } })) await db.task.create({ data: {
    title, responsibleUserId: user.id, createdBy: user.id, taskType: "other", status: "planned",
    priority: "normal", dueAt: new Date(Date.now() - 60000),
    propertyLinks: { create: { propertyId: property.id } },
  } });
  console.log(JSON.stringify({ event: "ops.synthetic_gallery_ready", properties: 1,
    documents: await db.document.count({ where: { propertyLinks: { some: { propertyId: property.id } } } }) }));
}
main().catch(() => { console.error("ops.synthetic_gallery_failed"); process.exitCode = 1; }).finally(disconnectDb);
