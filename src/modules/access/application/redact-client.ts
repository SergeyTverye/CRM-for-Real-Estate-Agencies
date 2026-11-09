import type { Actor } from "@/modules/auth/domain/actor";
import { canSeeClient } from "../domain/scopes";

export function redactClient<T extends { responsibleUserId: string }>(actor: Actor, client: T | null): T | null {
  return client && canSeeClient(actor, client) ? client : null;
}

export function redactClientLink<T extends { client: { responsibleUserId: string } | null; clientId?: string | null }>(actor: Actor, row: T): Omit<T, "client" | "clientId"> & { client: T["client"] | null; clientId?: string | null } {
  const client = redactClient(actor, row.client);
  return { ...row, client, ...("clientId" in row ? { clientId: client ? row.clientId : null } : {}) };
}
