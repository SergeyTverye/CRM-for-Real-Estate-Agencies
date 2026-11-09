import type { Code } from "@/shared/codebook";

export type Role = Code<"userRole">;


export interface Actor {
  userId: string;
  login: string;
  displayName: string;
  role: Role;
  mustChangePassword: boolean;
  sessionId: string;
}

export const isManager = (actor: Pick<Actor, "role">): boolean => actor.role === "manager";
