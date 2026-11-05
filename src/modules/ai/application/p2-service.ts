import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "@/modules/auth/domain/actor";
import { db } from "@/shared/db/client";
import { parseInput, zUuid } from "@/shared/validation";
import { DomainError, NotFoundError } from "@/shared/errors";
import { leadRequestScope, offerScope } from "@/modules/access/domain/scopes";
import { loadAccessibleClient } from "@/modules/clients/application/client-service";
import { loadAccessibleNeed, createNeed, updateNeedParams } from "@/modules/needs/application/need-service";
import { updateOffer } from "@/modules/commercial-offers/application/offer-service";
import { SearchFilters } from "@/modules/property-search/domain/types";
import { sanitizeFactContacts, sanitizeFreeNote, taskDraftSchema, checkOfferNumbers } from "../domain/p2-drafts";
import { AiError } from "../domain/contracts";
import { createPersistentSearchAi } from "./persistent-search-ai";
import { getAiLimits } from "./settings-service";
import type { SearchAi } from "../infrastructure/search-ai";

export const noteContextSchema = z.object({kind:z.enum(["client","request","need"]), id:zUuid}).strict();
type NoteContext = z.infer<typeof noteContextSchema>;
async function noteContext(actor: Actor, context: NoteContext) {
  let clientId: string, needId: string | undefined;
  if (context.kind === "client") clientId = context.id;
  else if (context.kind === "need") {
    const need = await loadAccessibleNeed(db, actor, context.id); clientId = need.clientId; needId = need.id;
  } else {
    const request = await db.leadRequest.findFirst({where:{id:context.id,...leadRequestScope(actor)}});
    if (!request) throw new NotFoundError();
    if (!request.clientId) throw new DomainError("AI_CLIENT_REQUIRED", "Сначала свяжите обращение с клиентом.");
    clientId = request.clientId; needId = request.clientNeedId ?? undefined;
    if (needId) await loadAccessibleNeed(db, actor, needId);
  }
  const client = await loadAccessibleClient(db, actor, clientId);
  const people = await db.clientContactPerson.findMany({where:{clientId},select:{fullName:true}});
  const staff = await db.user.findMany({select:{displayName:true}});
  return {clientId,needId,names:[client.displayName,...people.map(p=>p.fullName),...staff.map(u=>u.displayName)]};
}
export async function p2Available(actor: Actor) { return (await getAiLimits(actor)).modes.ai; }
export async function withP2Ai<T>(actor: Actor, type: "call_note" | "offer_text", work: (ai: SearchAi, context: {user:{userId:string;active:boolean};jobId:string;ownerUserId:string;requestId:string})=>Promise<T>, injected?: SearchAi) {
  if (!injected && !await p2Available(actor)) throw new DomainError("AI_DISABLED", "ИИ отключён. Данные можно заполнить вручную.");
  // Standalone budget context: only the durable ledger/reservation is persisted.
  const jobId = randomUUID();
  try {
    const ai = injected ?? await createPersistentSearchAi();
    const result = await work(ai,{user:{userId:actor.userId,active:true},jobId,ownerUserId:actor.userId,requestId:`${type}:${randomUUID()}`});
    return result;
  } catch (error) {
    if (error instanceof AiError) throw new DomainError(error.code, error.code === "AI_DISABLED" ? "ИИ отключён. Заполните данные вручную." : "Не удалось подготовить черновик: проверьте лимиты ИИ или уточните исходные данные.");
    throw error;
  }
}
export async function previewCallNote(actor: Actor, raw: unknown, injected?: SearchAi) {
  const input = parseInput(z.object({context:noteContextSchema,note:z.string().trim().min(1).max(4000)}).strict(),raw);
  const context = await noteContext(actor,input.context);
  const safe = sanitizeFreeNote(input.note, context.names);
  const draft = await withP2Ai(actor,"call_note",(ai,c)=>ai.parseCallNote(c,safe),injected);
  // Original note never enters persisted run or ledger. Preview remains in the browser only.
  const need = context.needId ? await loadAccessibleNeed(db,actor,context.needId) : null;
  return {...draft, expectedUpdatedAt:need?.updatedAt.toISOString() ?? null};
}
const confirmationSchema = z.object({context:noteContextSchema,confirmed:z.literal(true),filters:SearchFilters,
  task:taskDraftSchema,expectedUpdatedAt:z.iso.datetime().nullable()}).strict();
export async function confirmCallNote(actor: Actor, raw: unknown) {
  const input = parseInput(confirmationSchema,raw);
  const context = await noteContext(actor,input.context);
  if (!input.task.dueAt) throw new DomainError("TASK_DUE_REQUIRED","Укажите срок следующей задачи.");
  if (input.filters.operation === "rent" && input.filters.priceUnit !== "rub_month" && (input.filters.priceFrom || input.filters.priceTo))
    throw new DomainError("BUDGET_UNIT_REQUIRED","Для бюджета потребности укажите месячную аренду. Уточните сумму вручную.");
  const purpose = input.filters.purposes[0];
  const params = {operationType:input.filters.operation === "sale" ? "buy" : "rent",propertyType:"commercial",
    commercialPurpose:purpose === "psn_universal" || purpose === "free_purpose" ? "any" : purpose ?? null,
    budgetMin:input.filters.priceFrom ?? null,budgetMax:input.filters.priceTo ?? null,
    areaMin:input.filters.areaFrom?.toString() ?? null,areaMax:input.filters.areaTo?.toString() ?? null,
    district:input.filters.districts.join(", ") || null,locationText:input.filters.city,
    floorMin:input.filters.floorMode === "first_floor_only" ? 1 : input.filters.floorMode === "exclude_basement_and_semi_basement" ? 1 : null,
    floorMax:input.filters.floorMode === "first_floor_only" ? 1 : null,
    notes:[...input.filters.requiredFeatures,...input.filters.preferredFeatures.map(f=>`Предпочтение: ${f}`),
      `Назначения (ИЛИ): ${input.filters.purposes.join(", ")}`,`Этаж: ${input.filters.floorMode}`,`Продавец: ${input.filters.seller}`,`Единица бюджета: ${input.filters.priceUnit ?? "rub_total"}`].join("; ")};
  const nextAction = {...input.task,dueAt:input.task.dueAt};
  if (!context.needId) return createNeed(actor,{...params,clientId:context.clientId,nextAction});
  const previous = await loadAccessibleNeed(db,actor,context.needId);
  if (!input.expectedUpdatedAt) throw new DomainError("VERSION_REQUIRED","Обновите предпросмотр потребности.");
  return updateNeedParams(actor,context.needId,{...JSON.parse(JSON.stringify(previous)),...params,expectedUpdatedAt:input.expectedUpdatedAt,nextAction});
}
async function offerContext(actor: Actor, id: string) {
  const offer = await db.commercialOffer.findFirst({where:{id,...offerScope(actor)},include:{items:{orderBy:{position:"asc"}}}});
  if (!offer) throw new NotFoundError();
  const need = await loadAccessibleNeed(db,actor,offer.clientNeedId);
  await loadAccessibleClient(db,actor,need.clientId);
  if (offer.status !== "draft") throw new DomainError("OFFER_FROZEN","Создайте черновую редакцию КП для изменения текста.");
  const facts = {need:{operation:need.operationType,areaMin:need.areaMin?.toString(),areaMax:need.areaMax?.toString(),
    budgetMin:need.budgetMin?.toString(),budgetMax:need.budgetMax?.toString(),purpose:need.commercialPurpose},
    items:offer.items.map(i=>({address:sanitizeFactContacts(i.addressSnapshot ?? ""),area:i.areaSnapshot?.toString() ?? null,
      price:i.priceSnapshot?.toString() ?? null,confirmedCharacteristics:sanitizeFactContacts(i.termsSnapshot ?? "")}))};
  return {offer,facts};
}
export async function previewOfferText(actor: Actor, raw: unknown, injected?: SearchAi) {
  const input = parseInput(z.object({offerId:zUuid,kind:z.enum(["intro","comparison"])}).strict(),raw);
  const {offer,facts} = await offerContext(actor,input.offerId);
  const result = await withP2Ai(actor,"offer_text",(ai,c)=>ai.draftOfferText(c,facts,input.kind),injected);
  return {...result,expectedUpdatedAt:offer.updatedAt.toISOString()};
}
export async function confirmOfferText(actor: Actor, raw: unknown) {
  const input = parseInput(z.object({offerId:zUuid,confirmed:z.literal(true),text:z.string().trim().min(1).max(8000),
    expectedUpdatedAt:z.iso.datetime()}).strict(),raw);
  const {facts} = await offerContext(actor,input.offerId);
  try { checkOfferNumbers(input.text,facts); } catch { throw new DomainError("AI_UNSUPPORTED_NUMBERS","Числа в тексте не совпадают со снимками КП. Исправьте текст."); }
  return updateOffer(actor,input.offerId,{introText:input.text,expectedUpdatedAt:input.expectedUpdatedAt});
}
