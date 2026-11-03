import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { resolveSession } from "@/modules/auth/application/session-service";
import { SESSION_COOKIE } from "@/modules/auth/infrastructure/session-token";
import type { Actor } from "@/modules/auth/domain/actor";
import { setContextActor } from "@/shared/context";

/** Текущий пользователь для server components (кэшируется в пределах запроса). */
export const getPageActor = cache(async (): Promise<Actor | null> => {
  const store = await cookies();
  return resolveSession(store.get(SESSION_COOKIE)?.value);
});

/**
 * Требует аутентифицированного пользователя на странице. Каждая страница CRM
 * вызывает эту функцию сама — layout не перерисовывается при клиентской навигации.
 */
export async function requirePageActor(opts: { manager?: boolean; allowPasswordChange?: boolean } = {}): Promise<Actor> {
  const actor = await getPageActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword && !opts.allowPasswordChange) redirect("/change-password");
  if (opts.manager && actor.role !== "manager") redirect("/forbidden");
  setContextActor(actor.userId);
  return actor;
}
