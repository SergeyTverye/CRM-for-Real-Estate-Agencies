import type { Prisma } from "@/generated/prisma/client";
import { isManager, type Actor } from "@/modules/auth/domain/actor";

/**
 * Policy layer (ТЗ 3, 17.2, 25.3, 27): серверные правила видимости записей.
 * Каждая выборка и каждая команда модулей строит where из этих функций,
 * поэтому прямой API-запрос, поиск, экспорт и выдача файла подчиняются одним правилам.
 *
 * Руководитель видит всё. Риелтор:
 *  - Client — только свои (responsible_user_id = риелтор);
 *  - ClientNeed / LeadRequest — свои по ответственному либо принадлежащие его клиенту;
 *  - Property — весь каталог для чтения; изменение — только закреплённых за ним;
 *  - контакты собственника — закреплённый объект либо действующий grant руководителя;
 *  - Deal — свои по ответственному либо где участник — его клиент;
 *  - HistoricalDealArchive, импорт, отчёты, эксплуатация, администрирование — недоступны.
 */

export function clientScope(actor: Actor): Prisma.ClientWhereInput {
  return isManager(actor) ? {} : { responsibleUserId: actor.userId };
}

export function needScope(actor: Actor): Prisma.ClientNeedWhereInput {
  return isManager(actor) ? {} : { OR: [{ responsibleUserId: actor.userId }, { client: { responsibleUserId: actor.userId } }] };
}

export function leadRequestScope(actor: Actor): Prisma.LeadRequestWhereInput {
  return isManager(actor)
    ? {}
    : { OR: [{ responsibleUserId: actor.userId }, { client: { responsibleUserId: actor.userId } }] };
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

/** Каталог объектов доступен всем для чтения. */
export function propertyReadScope(_actor: Actor): Prisma.PropertyWhereInput {
  return {};
}

export function propertyWriteScope(actor: Actor): Prisma.PropertyWhereInput {
  return isManager(actor) ? {} : { responsibleUserId: actor.userId };
}

/** Объекты, контакты собственников которых доступны пользователю (ТЗ 17.2, FR-27, FR-30). */
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

/**
 * Документ доступен, если доступна хотя бы одна связанная бизнес-сущность (ТЗ 20.4, 27.4).
 * Для объекта: фото — всем, кто видит каталог; прочие документы объекта (правоустанавливающие,
 * договоры) — на уровне доступа к контактам собственника.
 */
export function documentScope(actor: Actor): Prisma.DocumentWhereInput {
  if (isManager(actor)) return {};
  return {
    OR: [
      { clientLinks: { some: { client: clientScope(actor) } } },
      { needLinks: { some: { need: needScope(actor) } } },
      { showingLinks: { some: { showing: showingScope(actor) } } },
      { dealLinks: { some: { deal: dealScope(actor) } } },
      { agreementLinks: { some: { agreement: agreementScope(actor) } } },
      { offerLinks: { some: { offer: offerScope(actor) } } },
      { advertisementLinks: { some: {} }, documentTypeCode: "photo" },
      { advertisementLinks: { some: { advertisement: advertisementWriteScope(actor) } } },
      { propertyLinks: { some: {} }, documentTypeCode: "photo" },
      { propertyLinks: { some: { property: ownerContactsScope(actor) } } },
    ],
  };
}

export function canManage(actor: Actor): boolean {
  return isManager(actor);
}

// ───── Предикаты для уже загруженных записей (подписи связей, карточки) ─────

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
