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
