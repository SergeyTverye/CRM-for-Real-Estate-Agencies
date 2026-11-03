import type { Code } from "@/shared/codebook";

export type Role = Code<"userRole">;

/** Аутентифицированный пользователь, от имени которого выполняется бизнес-команда. */
export interface Actor {
  userId: string;
  login: string;
  displayName: string;
  role: Role;
  mustChangePassword: boolean;
  sessionId: string;
}

export const isManager = (actor: Pick<Actor, "role">): boolean => actor.role === "manager";
