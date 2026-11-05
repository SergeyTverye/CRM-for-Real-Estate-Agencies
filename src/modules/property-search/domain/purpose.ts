import type { CriterionEvaluation, NormalizedListing } from "./types";

// Unicode boundaries prevent «дом» in «Домклик» and «ЖК» in «ЖКХ» from matching.
const residential = /(?<![\p{L}\p{N}_])(?:квартир[\p{L}]*|студи[\p{L}]*|апартамент[\p{L}]*[\s—–-]+жиль[\p{L}]*|жил[\p{L}]*\s+комплекс[\p{L}]*|жк|комнат[\p{L}]*|таунхаус[\p{L}]*|дом(?:а|ов|е|ом|у|ы)?|коттедж[\p{L}]*)(?![\p{L}\p{N}_])/iu;
const commercial = /(?<![\p{L}\p{N}_])(?:офис[\p{L}]*|торгов[\p{L}]*|псн|склад[\p{L}]*|производств[\p{L}]*|свободн[\p{L}]*\s+назначени[\p{L}]*|нежил[\p{L}]*|коммерческ[\p{L}]*)(?![\p{L}\p{N}_])/iu;
const residentialCategory = /^(?:residential|жилая(?:\s+недвижимость)?|жилое(?:\s+помещение)?|жиль[её])$/iu;

/** Negative evidence only: commercial wording alone never confirms a selected purpose. */
export function residentialPurposeContradiction(listing: NormalizedListing): CriterionEvaluation | null {
  for (const key of ["category", "propertyCategory", "propertyType", "purpose"]) {
    const value = listing.structuredFeatures[key];
    if (typeof value === "string" && residentialCategory.test(value.trim())) {
      return { criterion: "purpose", state: "contradicted", source: "structured", evidence: `${key}=${value}` };
    }
  }
  if (listing.purpose && listing.purposeSource !== "rule") return null;
  const text = [listing.title, listing.description].filter(Boolean).join("\n");
  const match = residential.exec(text);
  if (!match || commercial.test(text)) return null;
  // Keep a bounded verbatim fragment centred on the residential signal.
  const evidence = text.slice(Math.max(0, match.index - 60), match.index + match[0].length + 100).trim();
  return { criterion: "purpose", state: "contradicted", source: "rule", evidence };
}
