import type { Prisma } from "@/generated/prisma/client";
import { isManager, type Actor } from "@/modules/auth/domain/actor";



export function clientScope(actor: Actor): Prisma.ClientWhereInput {
  return isManager(actor) ? {} : { responsibleUserId: actor.userId };
}

export function needScope(actor: Actor): Prisma.ClientNeedWhereInput {
  return isManager(actor) ? {} : { OR: [{ responsibleUserId: actor.userId }, { client: { responsibleUserId: actor.userId } }] };
}


export function leadRequestScope(actor: Actor): Prisma.LeadRequestWhereInput {
  return isManager(actor)
    ? {}
    : { OR: [{ responsibleUserId: actor.userId }, { createdBy: actor.userId }, { client: { responsibleUserId: actor.userId } }] };
}

export function communicationScope(actor: Actor): Prisma.CommunicationWhereInput {
  return isManager(actor) ? {} : { OR: [{ authorUserId: actor.userId }, { client: { responsibleUserId: actor.userId } }] };
}

export function showingScope(actor: Actor): Prisma.ShowingWhereInput {
  return isManager(actor) ? {} : { OR: [{ responsibleUserId: actor.userId }, { need: needScope(actor) }] };
}

export function matchScope(actor: Actor): Prisma.NeedPropertyMatchWhereInput {
  return isManager(actor) ? {} : { need: needScope(actor) };
}

export function offerScope(actor: Actor): Prisma.CommercialOfferWhereInput {
  return isManager(actor) ? {} : { OR: [{ responsibleUserId: actor.userId }, { need: needScope(actor) }] };
}

export function taskScope(actor: Actor): Prisma.TaskWhereInput {
  return isManager(actor) ? {} : { OR: [{ responsibleUserId: actor.userId }, { createdBy: actor.userId }] };
}

export function dealScope(actor: Actor): Prisma.DealWhereInput {
  return isManager(actor)
    ? {}
    : { OR: [{ responsibleUserId: actor.userId }, { parties: { some: { client: { responsibleUserId: actor.userId } } } }] };
}

export function agreementScope(actor: Actor): Prisma.AgreementWhereInput {
  return isManager(actor)
    ? {}
    : {
        OR: [
          { responsibleUserId: actor.userId },
          { client: { responsibleUserId: actor.userId } },
          { property: { responsibleUserId: actor.userId } },
        ],
      };
}


export function propertyReadScope(_actor: Actor): Prisma.PropertyWhereInput {
  return {};
}

export function propertyWriteScope(actor: Actor): Prisma.PropertyWhereInput {
  return isManager(actor) ? {} : { responsibleUserId: actor.userId };
}


export function ownerContactsScope(actor: Actor): Prisma.PropertyWhereInput {
  if (isManager(actor)) return {};
  return {
    OR: [{ responsibleUserId: actor.userId }, { contactGrants: { some: { userId: actor.userId, revokedAt: null } } }],
  };
}

export function advertisementReadScope(_actor: Actor): Prisma.AdvertisementWhereInput {
  return {};
}

export function advertisementWriteScope(actor: Actor): Prisma.AdvertisementWhereInput {
  return isManager(actor) ? {} : { OR: [{ responsibleUserId: actor.userId }, { property: { responsibleUserId: actor.userId } }] };
}

export function documentScope(actor: Actor): Prisma.DocumentWhereInput {
  if (isManager(actor)) return {};
  const collection: Prisma.PropertyCollectionWhereInput = { archivedAt: null, OR: [{ ownerUserId: actor.userId }, { visibility: "team" }] };
  const need: Prisma.ClientNeedWhereInput = { AND: [needScope(actor), { client: clientScope(actor) }] };
  const showing: Prisma.ShowingWhereInput = { AND: [showingScope(actor), { need: { client: clientScope(actor) } }] };
  const offer: Prisma.CommercialOfferWhereInput = { AND: [offerScope(actor), { need: { client: clientScope(actor) } }] };
  const deal: Prisma.DealWhereInput = { AND: [dealScope(actor), { parties: { every: { OR: [{ clientId: null }, { client: clientScope(actor) }] } } }] };
  const agreement: Prisma.AgreementWhereInput = { AND: [agreementScope(actor), { OR: [{ clientId: null }, { client: clientScope(actor) }] }, { OR: [{ dealId: null }, { deal }] }] };
  return {
    AND: [
      { OR: [{ templateVersionId: null }, { valuesSnapshot: { path: ["accessRoles"], array_contains: [actor.role] } }] },
      { collectionLinks: { none: { collection: { NOT: collection } } } },
      { clientLinks: { none: { client: { NOT: clientScope(actor) } } } },
      { needLinks: { none: { need: { NOT: need } } } },
      { showingLinks: { none: { showing: { NOT: showing } } } },
      { dealLinks: { none: { deal: { NOT: deal } } } },
      { agreementLinks: { none: { agreement: { NOT: agreement } } } },
      { offerLinks: { none: { offer: { NOT: offer } } } },
      { OR: [
        { documentTypeCode: "photo" },
        { AND: [
          { propertyLinks: { none: { property: { NOT: ownerContactsScope(actor) } } } },
          { advertisementLinks: { none: { advertisement: { NOT: advertisementWriteScope(actor) } } } },
        ] },
      ] },
      { OR: [
        { collectionLinks: { some: { collection } } },
        { clientLinks: { some: { client: clientScope(actor) } } },
        { needLinks: { some: { need } } },
        { showingLinks: { some: { showing } } },
        { dealLinks: { some: { deal } } },
        { agreementLinks: { some: { agreement } } },
        { offerLinks: { some: { offer } } },
        { advertisementLinks: { some: {} }, documentTypeCode: "photo" },
        { advertisementLinks: { some: { advertisement: advertisementWriteScope(actor) } } },
        { propertyLinks: { some: {} }, documentTypeCode: "photo" },
        { propertyLinks: { some: { property: ownerContactsScope(actor) } } },
      ] },
    ],
  };
}

export function canManage(actor: Actor): boolean {
  return isManager(actor);
}



export function canSeeClient(actor: Actor, client: { responsibleUserId: string }): boolean {
  return isManager(actor) || client.responsibleUserId === actor.userId;
}

export function canSeeNeed(actor: Actor, need: { responsibleUserId: string; client: { responsibleUserId: string } }): boolean {
  return isManager(actor) || need.responsibleUserId === actor.userId || need.client.responsibleUserId === actor.userId;
}

export function canEditProperty(actor: Actor, property: { responsibleUserId: string | null }): boolean {
  return isManager(actor) || (property.responsibleUserId !== null && property.responsibleUserId === actor.userId);
}

export function canSeeDeal(actor: Actor, deal: { responsibleUserId: string; parties: { client: { responsibleUserId: string } | null }[] }): boolean {
  return (
    isManager(actor) ||
    deal.responsibleUserId === actor.userId ||
    deal.parties.some((p) => p.client?.responsibleUserId === actor.userId)
  );
}
