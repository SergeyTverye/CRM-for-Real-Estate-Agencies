import type { CriterionEvaluation, NormalizedListing } from "./types";


const residential = /(?<![\p{L}\p{N}_])(?:квартир[\p{L}]*|студи[\p{L}]*|апартамент[\p{L}]*[\s—–-]+жиль[\p{L}]*|жил[\p{L}]*\s+комплекс[\p{L}]*|жк|комнат[\p{L}]*|таунхаус[\p{L}]*|дом(?:а|ов|е|ом|у|ы)?|коттедж[\p{L}]*)(?![\p{L}\p{N}_])/iu;
const commercial = /(?<![\p{L}\p{N}_])(?:офис[\p{L}]*|торгов[\p{L}]*|псн|склад[\p{L}]*|производств[\p{L}]*|свободн[\p{L}]*\s+назначени[\p{L}]*|нежил[\p{L}]*|коммерческ[\p{L}]*)(?![\p{L}\p{N}_])/iu;
const residentialCategory = /^(?:residential|жилая(?:\s+недвижимость)?|жилое(?:\s+помещение)?|жиль[её])$/iu;


export const RESIDENTIAL_PURPOSE = "residential" as const;


export function residentialPurposeMatch(listing: NormalizedListing): CriterionEvaluation | null {
  for (const key of ["category", "propertyCategory", "propertyType", "purpose"]) {
    const value = listing.structuredFeatures[key];
    if (typeof value === "string" && residentialCategory.test(value.trim())) {
      return { criterion: "purpose", state: "matched", source: "structured", evidence: `${key}=${value}` };
    }
  }
  
  if (listing.purpose === RESIDENTIAL_PURPOSE) {
    return { criterion: "purpose", state: "matched", source: listing.purposeSource === "rule" ? "rule" : "structured", evidence: `purpose=${listing.purpose}` };
  }
  if (listing.purpose && listing.purposeSource === "structured") {
    return { criterion: "purpose", state: "contradicted", source: "structured", evidence: `purpose=${listing.purpose}` };
  }
  const text = [listing.title, listing.description].filter(Boolean).join("\n");
  const commercialSignal = commercial.test(text) || /бизнес[\s-]+пространств|делов\S*\s+центр|коммерци[яию]/iu.test(text);
  const legalResidential = /(?:статус|по\s+документам|юридически|оформлен[ао]?\s+как)\s*[:—-]?\s*(?:жилое\s+помещение|квартира)|(?:прода[её]тся|продам|сда[её]тся|сдам)\s+(?:\S+\s+){0,2}квартир\S*/iu.exec(text);
  if (legalResidential && !commercialSignal) {
    return { criterion: "purpose", state: "matched", source: "rule", evidence: text.slice(Math.max(0, legalResidential.index - 60), legalResidential.index + legalResidential[0].length + 100).trim() };
  }
  const match = residential.exec(text);
  if (!match || commercialSignal) {
    if (commercialSignal && !match) return { criterion: "purpose", state: "contradicted", source: "rule", evidence: text.slice(0, 300).trim() };
    return null;
  }
  const evidence = text.slice(Math.max(0, match.index - 60), match.index + match[0].length + 100).trim();
  return { criterion: "purpose", state: "matched", source: "rule", evidence };
}


export function hasAmbiguousLegacyPurpose(listing: NormalizedListing): boolean {
  if (listing.purposeSource || listing.purpose !== "office") return false;
  const text = [listing.title, listing.description].filter(Boolean).join("\n");
  return residential.test(text) && /делов\S*\s+центр|бизнес[\s-]+пространств|коммерци[яию]/iu.test(text)
    && !commercial.test(text);
}


export function residentialPurposeContradiction(listing: NormalizedListing): CriterionEvaluation | null {
  for (const key of ["category", "propertyCategory", "propertyType", "purpose"]) {
    const value = listing.structuredFeatures[key];
    if (typeof value === "string" && residentialCategory.test(value.trim())) {
      return { criterion: "purpose", state: "contradicted", source: "structured", evidence: `${key}=${value}` };
    }
  }
  const text = [listing.title, listing.description].filter(Boolean).join("\n");
  const legalResidential = /(?:статус|по\s+документам|юридически|оформлен[ао]?\s+как)\s*[:—-]?\s*(?:жилое\s+помещение|квартира)|(?:прода[её]тся|продам|сда[её]тся|сдам)\s+(?:\S+\s+){0,2}квартир\S*/iu.exec(text);
  if (legalResidential) return { criterion: "purpose", state: "contradicted", source: "rule", evidence: text.slice(Math.max(0, legalResidential.index - 60), legalResidential.index + legalResidential[0].length + 100).trim() };
  
  if (listing.purpose && listing.purposeSource === "structured") return null;
  const match = residential.exec(text);
  if (!match || commercial.test(text) || /бизнес[\s-]+пространств|делов\S*\s+центр|коммерци[яию]/iu.test(text)) return null;
  
  const evidence = text.slice(Math.max(0, match.index - 60), match.index + match[0].length + 100).trim();
  return { criterion: "purpose", state: "contradicted", source: "rule", evidence };
}
