import type { InteractiveSession, SessionRepository } from "../domain/session";
import { isLive } from "../domain/session";

/** Tests only. Production never silently falls back to an ephemeral repository. */
export class MemorySessionRepository implements SessionRepository {
  private rows = new Map<string, InteractiveSession>();
  async claim(session: InteractiveSession) {
    if ([...this.rows.values()].some(s => isLive(s) && s.ownerUserId === session.ownerUserId && s.source === session.source)) return false;
    this.rows.set(session.id, structuredClone(session)); return true;
  }
  async get(id: string) { return structuredClone(this.rows.get(id) ?? null); }
  async active(ownerUserId: string, source: InteractiveSession["source"]) { return structuredClone([...this.rows.values()].find(s => s.ownerUserId === ownerUserId && s.source === source && isLive(s)) ?? null); }
  async save(session: InteractiveSession) { const current = this.rows.get(session.id); if (current && isLive(current)) this.rows.set(session.id, structuredClone(session)); }
}
