import type { Floor } from "./types";

export function parseFloor(value: unknown): Floor {
  const raw = value === null || value === undefined ? null : String(value).trim();
  const unknown: Floor = { kind: "unknown", number: null, raw };
  if (!raw) return unknown;
  if (/полуподвал|цокол/iu.test(raw)) return { kind: "semi_basement", number: null, raw };
  if (/подвал/iu.test(raw)) return { kind: "basement", number: null, raw };
  const match = raw.match(/^(?:этаж\s*)?(-?\d+)\s*(?:\/\s*\d+|(?:-?й)?\s*этаж)?$/iu);
  if (!match) return unknown;
  const number = Number(match[1]);
  return { kind: number < 0 ? "basement" : number === 0 ? "unknown" : "above_ground", number, raw };
}

/** Only an explicit description of this room can contradict a positive source floor. */
export function describedUndergroundFloor(description: string): Floor | null {
  for (const clause of description.split(/[!?;\n]|(?<!\d)\.|\.(?!\d)/u)) {
    if (/(?:без|нет|не\s+является|не\s+на)\s+(?:\S+\s+){0,2}(?:цокол|подвал|полуподвал)/iu.test(clause)) continue;
    // «Есть подвал» / «рядом цоколь» can describe an additional room, not the lot.
    const match = /помещени\S*\s+(?:расположен\S*\s+|на\s+|в\s+)*|^\s*(?:цоколь\S*|подвал\S*|полуподвал\S*)\s+этаж|^\s*этаж\s*[:—-]/iu.exec(clause);
    if (!match) continue;
    const floor = /(?:цоколь\S*|полуподвал\S*|подвал\S*)\s+этаж|этаж\s*[:—-]?\s*(?:цоколь\S*|полуподвал\S*|подвал\S*)/iu.exec(clause);
    if (floor) return parseFloor(floor[0]);
  }
  return null;
}
