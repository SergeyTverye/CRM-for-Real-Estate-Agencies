import { createHash } from "node:crypto";
import { independentCommitScope } from "@/shared/db/client";
import { lockSql } from "@/shared/db/dialect";
import { z } from "zod";
import { db, transaction, Prisma } from "@/shared/db/client";
import { parseInput, zUuid } from "@/shared/validation";
import { DomainError, NotFoundError, StaleUpdateError } from "@/shared/errors";
import type { Actor } from "@/modules/auth/domain/actor";
import { loadAccessibleNeed } from "@/modules/needs/application/need-service";
import { createTask } from "@/modules/tasks/application/task-service";
import { SearchFilters, type NormalizedListing } from "@/modules/property-search/domain/types";
import { evaluateListing } from "@/modules/property-search/domain/evaluation";
import { parseFloor } from "@/modules/property-search/domain/floor";
import { singleton, aiUsageLogId } from "../infrastructure/prisma-repositories";
import { effectiveAiSettings } from "./settings-service";
import { getConfig } from "@/shared/config/env";
import { withP2Ai } from "./p2-service";
import type { SearchAi } from "../infrastructure/search-ai";
import type { AiCallContext } from "../infrastructure/search-ai";
import { ANALYSIS_WARNING, analysisCacheKey, filterDiff, forbiddenAnalysisCriterion, preserveSearchConditions, safeListingText, analysisCriterionLabel } from "../domain/listing-analysis";
import { checkOfferNumbers } from "../domain/p2-drafts";

const selectionSchema = z.object({listingIds:z.array(zUuid).min(1).max(20), filters:SearchFilters, needId:zUuid.optional()}).strict();
type Selection = z.infer<typeof selectionSchema>;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
async function settings() {
  const row = await db.$transaction(tx => singleton(tx));
  return effectiveAiSettings(row, getConfig()).values;
}
async function available() {
  const value = await settings();
  if (!value.aiEnabled) throw new DomainError("AI_DISABLED", "ИИ отключён. Ручной поиск, фильтры и экспорт доступны.");
  return value;
}
/** Legacy parse/description ledger requires an owned SearchRun FK. Create it only
 * on an actual cache miss, and never persist input descriptions or query text. */
async function withListingAi<T>(actor: Actor, work:(ai:SearchAi,context:AiCallContext)=>Promise<T>, injected?:SearchAi, filters?:SearchFilters) {
  return withP2Ai(actor,"offer_text",async (ai,context)=>{
    await db.searchRun.create({data:{id:context.jobId,userId:actor.userId,filters:json(filters ?? SearchFilters.parse({operation:"sale"})),status:"running",startedAt:new Date()}});
    try {
      const result=await work(ai,context);
      await db.searchRun.update({where:{id:context.jobId},data:{status:"success",finishedAt:new Date()}});
      return result;
    } catch(error) {
      await db.searchRun.update({where:{id:context.jobId},data:{status:"error",finishedAt:new Date()}});
      throw error;
    }
  },injected);
}
async function selected(actor: Actor, input: Selection) {
  if (input.needId) await loadAccessibleNeed(db, actor, input.needId);
  if (new Set(input.listingIds).size !== input.listingIds.length) throw new DomainError("DUPLICATE_SELECTION", "Объявление выбрано несколько раз.");
  // Public external market catalogue is shared, unlike personal runs, needs and collections.
  const rows = await db.externalListing.findMany({where:{id:{in:input.listingIds}},include:{snapshots:{orderBy:{fetchedAt:"desc"},take:1},verifications:{orderBy:{verifiedAt:"desc"},take:1}}});
  if (rows.length !== input.listingIds.length) throw new NotFoundError();
  return input.listingIds.map(id => rows.find(r => r.id === id)!);
}
type Listing = Awaited<ReturnType<typeof selected>>[number];
function normalized(row: Listing): NormalizedListing {
  const snapshot = row.snapshots[0]?.normalized as Partial<NormalizedListing> | undefined;
  const employee = row.verifications[0];
  const ownerVerification = row.ownerConfirmed && row.ownerConfirmationMethod && row.ownerConfirmedAt && employee?.ownerConfirmed ? {source:"employee",method:row.ownerConfirmationMethod,checkedAt:row.ownerConfirmedAt.toISOString(),verifiedBy:employee.verifiedBy} : undefined;
  return {source:row.source as NormalizedListing["source"],sourceListingId:row.sourceListingId,sourceUnitId:row.sourceUnitId,url:row.url,
    operation:row.operation as "sale"|"rent",purpose:(row.purposes[0] ?? null) as NormalizedListing["purpose"],
    price:row.priceRub?.toString() ?? null,priceUnit:(snapshot && "priceUnit" in snapshot ? snapshot.priceUnit ?? null : ({total:"rub_total",per_month:"rub_month",per_year:"rub_year",per_m2_month:"rub_m2_month",per_m2_year:"rub_m2_year"}[row.priceUnit ?? ""] ?? null)) as NormalizedListing["priceUnit"],
    area:row.areaM2 === null ? null : Number(row.areaM2),floor:parseFloor(row.floorRaw ?? row.floorNumber),city:row.city,address:row.address,district:row.district,
    seller:{type:row.sellerType === "agent" ? "agent" : "unknown",ownerVerification},description:safeListingText(row.description ?? ""),
    images:Array.isArray(row.images) ? row.images.filter((x): x is string => typeof x === "string") : [],
    fetchedAt:(row.fetchedAt ?? row.lastSeenAt).toISOString(),structuredFeatures:snapshot?.structuredFeatures ?? {},
    possibleDuplicateKeys:[],identityNeedsReview:false,publishedAt:row.publishedAt?.toISOString(),firstSeenAt:row.firstSeenAt.toISOString(),lastCheckedAt:row.lastCheckedAt?.toISOString()};
}
function prepare(row: Listing, filters: SearchFilters) {
  const listing = normalized(row), evaluation = evaluateListing(listing, filters);
  const unknown = evaluation.criteria.filter(c => c.state === "unknown");
  // Only required public descriptive features. Typed numeric ranges remain rule-based.
  const criteria = [...new Set(unknown.filter(c => (filters.requiredFeatures.includes(c.criterion) || c.criterion.startsWith("features.") && filters.features?.[c.criterion.slice(9) as keyof NonNullable<SearchFilters["features"]>] === true) && !forbiddenAnalysisCriterion(analysisCriterionLabel(c.criterion))).map(c => analysisCriterionLabel(c.criterion)))].sort();
  return {row,listing,evaluation,unknown,criteria};
}
export async function analyzeListingBatch(actor: Actor, raw: unknown, injected?: SearchAi) {
  const input = parseInput(selectionSchema,raw), config = await available();
  const rows = await selected(actor,input);
  const limit = Math.min(20,config.perJobLimit);
  if (rows.length > limit) throw new DomainError("AI_ANALYSIS_LIMIT", `Для анализа выберите не более ${limit} объявлений (лимит руководителя).`);
  const prepared = rows.map(row=>prepare(row,input.filters));
  // Cross-process serialization avoids two simultaneous paid analyses of the same data.
  return independentCommitScope(async tx => {
    const keys = prepared.filter(p=>p.criteria.length).map(p=>analysisCacheKey(p.listing.description,p.criteria,config.model));
    for (const key of [...new Set(keys)].sort()) await tx.$executeRaw(lockSql(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`));
    const results: {listingId:string;source:string;url:string;warning:string;ruleChecks:ReturnType<typeof evaluateListing>["criteria"];cacheHit:boolean;evidence:unknown;unresolved:string[]}[] = [];
    const pending = [];
    for (const p of prepared) {
      const cacheKey = analysisCacheKey(p.listing.description,p.criteria,config.model);
      const cached = p.criteria.length ? await tx.aiAnalysisCache.findUnique({where:{cacheKey}}) : null;
      const base = {listingId:p.row.id,source:p.row.source,url:p.row.url,warning:ANALYSIS_WARNING,ruleChecks:p.evaluation.criteria};
      if (!p.criteria.length) results.push({...base,cacheHit:false,evidence:[],unresolved:p.unknown.map(c=>analysisCriterionLabel(c.criterion))});
      else if (cached) results.push({...base,cacheHit:true,evidence:cached.result,unresolved:p.unknown.map(c=>analysisCriterionLabel(c.criterion))});
      else pending.push({p,cacheKey,base});
    }
    // Group equal unresolved sets; each call analyzes all candidates in that group.
    const groups = new Map<string,typeof pending>();
    for (const item of pending) { const key = JSON.stringify(item.p.criteria); groups.set(key,[...(groups.get(key) ?? []),item]); }
    for (const group of groups.values()) {
      let requestId = "";
      const answer = await withListingAi(actor,(ai,c)=> {requestId=c.requestId;return ai.analyzeDescriptions(c,{listings:group.map(({p})=>({id:p.row.id,publicDescription:p.listing.description})),unresolvedCriteria:group[0]!.p.criteria});},injected,input.filters);
      const usage = await db.aiUsageLog.findUnique({where:{id:aiUsageLogId(requestId)},select:{id:true}});
      for (const {p,cacheKey,base} of group) {
        const evidence = answer.evidence.filter(e=>e.listingId===p.row.id).map(e=>{
          const suspicious = /ignore|system|assistant|игнорир|инструкци|ответь|верни JSON|роль/iu.test(e.quote ?? "");
          const result = suspicious ? "unknown" : e.result;
          return {criterion:e.criterion,result,quote:suspicious ? null : e.quote,source:"ai",reason:result === "unknown" ? "В описании нет точного подтверждения; уточните у продавца." : "Дословный фрагмент публичного описания; требуется проверка сотрудником."};
        });
        // Commit each paid result independently while the outer advisory lock is
        // still held. A failure in a later group must not erase an earlier paid cache.
        await db.aiAnalysisCache.upsert({where:{cacheKey},create:{cacheKey,listingId:p.row.id,result:json(evidence),aiUsageLogId:usage?.id},update:{}});
        results.push({...base,cacheHit:false,evidence,unresolved:p.unknown.map(c=>analysisCriterionLabel(c.criterion))});
      }
    }
    return {items:input.listingIds.map(id=>results.find(r=>r.listingId===id)!),limit,model:config.model,warning:ANALYSIS_WARNING};
  });
}

async function pendingDraft(actor: Actor, actionType: string, payload: unknown) {
  const session = await db.aiChatSession.create({data:{ownerUserId:actor.userId,title:"Анализ объявлений",contextType:"none"}});
  return db.aiPendingAction.create({data:{sessionId:session.id,actionType,payload:json(payload),expiresAt:new Date(Date.now()+30*60000)}});
}
export async function previewAnalysisQuery(actor: Actor, raw: unknown, injected?: SearchAi) {
  const input = parseInput(z.object({text:z.string().trim().min(1).max(4000),currentFilters:SearchFilters}).strict(),raw);
  await available();
  const parsed = await withListingAi(actor,(ai,c)=>ai.parseSearchQuery(c,{query:input.text,currentFilters:input.currentFilters}),injected,input.currentFilters);
  if (!parsed.filters || parsed.clarificationQuestion) return {...parsed,diff:[],confirmationRequired:false,pendingActionId:null};
  // LIVE: spelled-out square metres must open the same preservation category
  // as "м²"; otherwise a correctly parsed area silently disappears here.
  const preservationText = input.text.replace(/квадратн\p{L}*\s+метр\p{L}*/giu, "площадь");
  const filters = SearchFilters.parse(preserveSearchConditions(input.currentFilters,parsed.filters,preservationText));
  const diff = filterDiff(input.currentFilters,filters);
  const draft = await pendingDraft(actor,"listing_analysis_filters",{before:input.currentFilters,filters});
  return {...parsed,filters,diff,confirmationRequired:true,pendingActionId:draft.id};
}
export async function confirmAnalysisQuery(actor: Actor, raw: unknown) {
  const input = parseInput(z.object({pendingActionId:zUuid,confirmed:z.literal(true),currentFilters:SearchFilters}).strict(),raw);
  return transaction(async tx=>{
    const action = await tx.aiPendingAction.findFirst({where:{id:input.pendingActionId,actionType:"listing_analysis_filters",status:"proposed",session:{ownerUserId:actor.userId},expiresAt:{gt:new Date()}}});
    if (!action) throw new NotFoundError();
    const payload = action.payload as unknown as {before:SearchFilters;filters:SearchFilters};
    if (filterDiff(payload.before,input.currentFilters).length) throw new StaleUpdateError();
    const claimed = await tx.aiPendingAction.updateMany({where:{id:action.id,status:"proposed"},data:{status:"confirmed",decidedBy:actor.userId,decidedAt:new Date()}});
    if (!claimed.count) throw new StaleUpdateError();
    return {filters:SearchFilters.parse(payload.filters),confirmed:true};
  });
}
export async function suggestAnalysisTasks(actor: Actor, raw: unknown) {
  const input = parseInput(selectionSchema,raw); await available();
  const rows = await selected(actor,input), config = await settings();
  if (rows.length > Math.min(20,config.perJobLimit)) throw new DomainError("AI_ANALYSIS_LIMIT","Сократите число объявлений.");
  const tasks = rows.flatMap(row=>{
    const p = prepare(row,input.filters);
    return p.unknown.length ? [{listingId:row.id,title:"Уточнить характеристики объявления",description:`${row.url}\nПроверить: ${p.unknown.map(c=>analysisCriterionLabel(c.criterion)).join("; ")}`,needId:input.needId ?? null,propertyId:row.propertyId,expectedUpdatedAt:row.updatedAt.toISOString()}] : [];
  });
  if (!tasks.length) return {tasks:[],pendingActionId:null,confirmationRequired:false};
  const action = await pendingDraft(actor,"listing_analysis_tasks",{tasks});
  return {tasks,pendingActionId:action.id,confirmationRequired:true};
}
export async function confirmAnalysisTasks(actor: Actor, raw: unknown) {
  const input = parseInput(z.object({pendingActionId:zUuid,confirmed:z.literal(true),dueAt:z.iso.datetime()}).strict(),raw);
  return transaction(async tx=>{
    await tx.$executeRaw(lockSql(Prisma.sql`SELECT id FROM ai_pending_actions WHERE id=${input.pendingActionId}::uuid FOR UPDATE`));
    const action = await tx.aiPendingAction.findFirst({where:{id:input.pendingActionId,actionType:"listing_analysis_tasks",session:{ownerUserId:actor.userId},expiresAt:{gt:new Date()}}});
    if (!action) throw new NotFoundError();
    const payload = action.payload as unknown as {tasks:{listingId:string;title:string;description:string;needId:string|null;propertyId:string|null;expectedUpdatedAt:string}[];created?:{id:string}[]};
    if (action.status === "confirmed") return {tasks:payload.created ?? [],alreadyConfirmed:true};
    if (action.status !== "proposed") throw new NotFoundError();
    const created = [];
    for (const task of payload.tasks) {
      const row = await tx.externalListing.findUnique({where:{id:task.listingId}});
      if (!row) throw new NotFoundError();
      if (row.updatedAt.toISOString() !== task.expectedUpdatedAt) throw new StaleUpdateError();
      if (task.needId) await loadAccessibleNeed(tx,actor,task.needId);
      created.push(await createTask(actor,{title:task.title,description:task.description,taskType:"call_or_contact",dueAt:input.dueAt,links:{needIds:task.needId ? [task.needId] : [],propertyIds:task.propertyId ? [task.propertyId] : []}},tx));
    }
    await tx.aiPendingAction.update({where:{id:action.id},data:{status:"confirmed",decidedBy:actor.userId,decidedAt:new Date(),payload:json({...payload,created})}});
    return {tasks:created,alreadyConfirmed:false};
  });
}

async function draftSelectionText(actor: Actor, raw: unknown, kind: "intro"|"comparison", injected?: SearchAi) {
  const input = parseInput(selectionSchema,raw); await available();
  if (kind === "comparison" && (input.listingIds.length<2 || input.listingIds.length>4)) throw new DomainError("AI_COMPARE_COUNT","Выберите от двух до четырёх объектов.");
  const rows = await selected(actor,input);
  const items = rows.map(row=>{
    const p = prepare(row,input.filters);
    // Unverified text is never promoted to verified facts or fed into drafting.
    return {address:safeListingText(row.address ?? "Адрес не указан"),area:row.areaM2?.toString() ?? null,price:row.priceRub?.toString() ?? null,priceUnit:p.listing.priceUnit,pricePeriodNotice:p.listing.priceUnit ? null : "Период цены неизвестен — цены несопоставимы до проверки",
      confirmedCharacteristics:p.evaluation.criteria.filter(c=>c.state==="matched" && c.source==="structured").map(c=>`${c.criterion}: ${c.evidence}`)};
  });
  // Unknown criterion labels are intentionally NOT model facts: LIVE showed that
  // a model can promote the word 'unknown' to an asserted characteristic.
  const facts = {items,requirements:"Объясни компромиссы только по полям каждого объекта. Укажи единицы площади и цены. Не подтверждай собственника или доступность. Отсутствующие характеристики не упоминай как существующие. Не придумывай характеристики и числа. Если период цены неизвестен — цены несопоставимы до проверки; не называй цену общей и не делай выводов о выгоде."};
  const draft = await withP2Ai(actor,"offer_text",(ai,c)=>ai.draftOfferText(c,facts,kind),injected);
  checkOfferNumbers(draft.text,facts);
  const tradeoffs = kind === "comparison" ? rows.map(row=>({listingId:row.id,points:rows.filter(other=>other.id!==row.id).map(other=>{
    const area=row.areaM2 && other.areaM2 ? row.areaM2.comparedTo(other.areaM2) : null;
    const unit=normalized(row).priceUnit, otherUnit=normalized(other).priceUnit;
    const price=unit !== null && row.operation===other.operation && unit===otherUnit && row.priceRub && other.priceRub ? row.priceRub.comparedTo(other.priceRub) : null;
    return {comparedListingId:other.id,area:area===null ? "Площадь неизвестна — сравнение невозможно." : area>0 ? "Больше площади, чем у другого выбранного варианта." : area<0 ? "Меньше площади, чем у другого выбранного варианта." : "Площади совпадают.",price:price===null ? "Цены неизвестны или единицы несовместимы — сравнение невозможно." : price>0 ? "Цена выше: оцените дополнительную нагрузку на бюджет." : price<0 ? "Цена ниже: остаётся больше бюджета на остальные расходы." : "Цены совпадают при одинаковой единице цены."};
  })})) : [];
  return {...draft,text:`${draft.text}\n\n${ANALYSIS_WARNING}`,warning:ANALYSIS_WARNING,
    tradeoffs,
    questions:rows.map(row=>({listingId:row.id,questions:[...prepare(row,input.filters).unknown.map(c=>`Уточните: ${analysisCriterionLabel(c.criterion)}`),"Кто собственник? Как подтверждены полномочия?","Доступно ли помещение сейчас?"]})),draftOnly:true};
}
export const compareAnalysisListings = (actor:Actor,raw:unknown,injected?:SearchAi)=>draftSelectionText(actor,raw,"comparison",injected);
export const collectionAnalysisText = (actor:Actor,raw:unknown,injected?:SearchAi)=>draftSelectionText(actor,raw,"intro",injected);

/** Shares the durable analysis cache, cross-process lock and existing budget gate. */
export async function rankAnalysisListings(actor:Actor,raw:unknown,injected?:SearchAi) {
  const input=parseInput(selectionSchema,raw),config=await available();
  if(input.listingIds.length<2 || input.listingIds.length>10) throw new DomainError("AI_RANK_COUNT","Выберите от двух до десяти объявлений.");
  if(input.listingIds.length>config.perJobLimit) throw new DomainError("AI_ANALYSIS_LIMIT","Сократите число объявлений: достигнут лимит руководителя.");
  const rows=await selected(actor,input);
  const facts={items:rows.map(row=>{
    const p=prepare(row,input.filters);
    return {listingId:row.id,criteria:[...p.evaluation.criteria,...p.evaluation.preferences].filter(c=>!forbiddenAnalysisCriterion(c.criterion)).map(c=>({criterion:c.criterion,state:c.state,evidence:safeListingText(c.evidence)})),pricePeriodNotice:p.listing.priceUnit ? null : "Период цены неизвестен — цены несопоставимы до проверки"};
  }).sort((a,b)=>a.listingId.localeCompare(b.listingId))};
  // Filters and evidence are fingerprinted. Updated facts or model invalidate recommendations.
  const cacheKey=createHash("sha256").update(JSON.stringify(["listing-ranking-v1",config.model,input.filters,facts])).digest("hex");
  return independentCommitScope(async tx=>{
    await tx.$executeRaw(lockSql(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${cacheKey},0))`));
    const cached=await tx.aiAnalysisCache.findUnique({where:{cacheKey}});
    if(cached) return {...cached.result as unknown as {ranking:{listingId:string;reasons:string[]}[];warning:string;recommendationOnly:boolean;model:string},cacheHit:true};
    let requestId="";
    const response=await withP2Ai(actor,"offer_text",(ai,c)=>{requestId=c.requestId;return ai.rankListings(c,facts);},injected);
    const ranking=response.ranking.map(item=>({listingId:item.listingId,reasons:item.reasonCriteria.map(key=>{
      const criterion=facts.items.find(row=>row.listingId===item.listingId)!.criteria.find(c=>c.criterion===key)!;
      const state=criterion.state==="matched" ? "соответствует" : criterion.state==="contradicted" ? "противоречит" : "неизвестно, требует проверки";
      return `${analysisCriterionLabel(key)}: ${state}. ${criterion.evidence}`;
    })}));
    const result={ranking,warning:ANALYSIS_WARNING,recommendationOnly:true,model:response.model};
    const usage=await db.aiUsageLog.findUnique({where:{id:aiUsageLogId(requestId)},select:{id:true}});
    await db.aiAnalysisCache.upsert({where:{cacheKey},create:{cacheKey,listingId:facts.items[0]!.listingId,result:json(result),aiUsageLogId:usage?.id},update:{}});
    return {...result,cacheHit:false};
  });
}
