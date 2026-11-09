import { Prisma } from "@/generated/prisma/client";
import { lockSql } from "@/shared/db/dialect";
import { ConflictError } from "@/shared/errors";
import { db, transaction } from "@/shared/db/client";
import type { InteractiveSession, SessionRepository } from "../domain/session";

interface SessionDelegate {
  findUnique(args: { where: { id: string } }): Promise<InteractiveSession | null>;
  findFirst(args: { where: { ownerUserId: string; source: string; status: { in: string[] } } }): Promise<InteractiveSession | null>;
  create(args: { data: InteractiveSession }): Promise<unknown>;
  updateMany(args: { where: { id: string; status: { in: string[] } }; data: InteractiveSession }): Promise<unknown>;
}
function delegate(client: unknown): SessionDelegate {
  const value = (client as { interactiveBrowserSession?: SessionDelegate }).interactiveBrowserSession;
  if (!value) throw new Error("BROWSER_SESSION_MIGRATION_REQUIRED");
  return value;
}
export class PrismaSessionRepository implements SessionRepository {
  async claim(session: InteractiveSession, maximum = 3) {
    return transaction(async tx => {
      await tx.$executeRaw(lockSql(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`browser-session:${session.ownerUserId}:${session.source}`}, 0))`));
      await tx.$executeRaw(lockSql(Prisma.sql`SELECT pg_advisory_xact_lock(310106)`));
      const count = await tx.interactiveBrowserSession.count({ where: { status: { in: ["pending", "active"] }, expiresAt: { gt: new Date() } } });
      if (count >= maximum) throw new ConflictError("BROWSER_CAPACITY", "Все интерактивные сеансы заняты. Повторите после закрытия открытых сеансов.");
      const table = delegate(tx);
      if (await table.findFirst({ where: { ownerUserId: session.ownerUserId, source: session.source, status: { in: ["pending", "active"] } } })) return false;
      await table.create({ data: session }); return true;
    });
  }
  get(id: string) { return delegate(db).findUnique({ where: { id } }); }
  active(ownerUserId: string, source: InteractiveSession["source"]) { return delegate(db).findFirst({ where: { ownerUserId, source, status: { in: ["pending", "active"] } } }); }
  async save(session: InteractiveSession) { await delegate(db).updateMany({ where: { id: session.id, status: { in: ["pending", "active"] } }, data: session }); }
}
