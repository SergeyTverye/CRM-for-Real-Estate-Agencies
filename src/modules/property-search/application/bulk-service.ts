import { z } from "zod";
import { db } from "@/shared/db/client";
import { parseInput, zUuid } from "@/shared/validation";
import { AppError, NotFoundError } from "@/shared/errors";
import type { Actor } from "@/modules/auth/domain/actor";
import { addItems } from "@/modules/collections/application/collection-service";
import { accessibleRun } from "./search-service";
import { setBookmark, clarifyListing, transferToCatalog, proposeListing, listingToOffer } from "./listing-service";
export interface CollectionAdder { add(actor: Actor, collectionId: string, listingId: string): Promise<unknown> }
let collectionAdder: CollectionAdder | undefined;
export function configureSearchCollectionAdder(port: CollectionAdder) { collectionAdder = port; }
export async function addListingToCollection(actor: Actor, collectionId: string, listingId: string) {
  if (collectionAdder) return collectionAdder.add(actor, collectionId, listingId);
  return addItems(actor, collectionId, [{ externalListingId: listingId }]);
}
const bulkInput = z.object({ ids: z.array(zUuid).min(1).max(100).refine(ids => ids.length === new Set(ids).size), action: z.enum(["bookmark", "collection", "clarify", "catalog", "propose", "offer"]), data: z.record(z.string(), z.unknown()).default({}) }).strict();

export async function bulkSearchAction(actor: Actor, runId: string, raw: unknown) {
  const input = parseInput(bulkInput, raw);
  await accessibleRun(actor, runId);
  const count = await db.searchRunResult.count({ where: { runId, listingId: { in: input.ids } } });
  if (count !== input.ids.length) throw new NotFoundError();
  const commands = { bookmark: setBookmark, clarify: clarifyListing, catalog: transferToCatalog, propose: proposeListing, offer: listingToOffer };
  const results = [];
  for (const id of input.ids) {
    try {
      const value = input.action === "collection" ? await addListingToCollection(actor, parseInput(zUuid, input.data.collectionId), id) : await commands[input.action](actor, id, input.data);
      results.push({ id, success: true, value });
    } catch (error) { results.push({ id, success: false, error: error instanceof AppError ? { code: error.code, message: error.message } : { code: "ACTION_FAILED", message: "Не удалось выполнить действие" } }); }
  }
  return { results };
}
