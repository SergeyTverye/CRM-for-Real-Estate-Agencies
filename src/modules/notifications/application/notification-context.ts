import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/modules/auth/domain/actor";
import { clientScope } from "@/modules/access/domain/scopes";

/** All links must be safe, including indirect client references. */
export function safeTaskTextScope(actor: Actor): Prisma.TaskWhereInput {
  if (actor.role === "manager") return {};
  const foreign = { NOT: clientScope(actor) };
  const foreignDeal = { parties: { some: { client: foreign } } };
  return { AND: [
    { clientLinks: { none: { client: foreign } } },
    { needLinks: { none: { need: { client: foreign } } } },
    { showingLinks: { none: { showing: { need: { client: foreign } } } } },
    { offerLinks: { none: { offer: { need: { client: foreign } } } } },
    { agreementLinks: { none: { agreement: { OR: [{ client: foreign }, { deal: foreignDeal }] } } } },
    { dealLinks: { none: { deal: foreignDeal } } },
  ] };
}
