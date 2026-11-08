import type { SearchFilters } from "./types";

export const ROOM_LABELS = { studio: "Студия", "1": "1", "2": "2", "3": "3", "4+": "4+" } as const;
export type RoomChoice = keyof typeof ROOM_LABELS;
/** Only explicit counts: floor numbers, area and euro-layouts are not room counts. */
export function parseRooms(value: unknown, title = ""): number | null {
  if ((typeof value === "number" || typeof value === "string" && /^\d{1,2}$/u.test(value)) && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 30) return Number(value);
  if (/студи[яиюи]/iu.test(title)) return 0;
  const count = title.match(/(?<![\p{L}\d])([1-9]\d?)\s*[-–]?\s*(?:к\.|комн|комнат)/iu);
  if (count) return Number(count[1]);
  const words: [RegExp, number][] = [[/однокомнат|однушк/iu, 1], [/двухкомнат|двушк/iu, 2], [/тр[её]хкомнат|тр[её]шк/iu, 3], [/четыр[её]хкомнат/iu, 4], [/пятикомнат/iu, 5]];
  return words.find(([pattern]) => pattern.test(title))?.[1] ?? null;
}
export function roomChoice(count: number): RoomChoice { return count === 0 ? "studio" : count >= 4 ? "4+" : String(count) as RoomChoice; }
export function residentialRooms(filters: SearchFilters): boolean {
  return !!filters.rooms?.length && (!!filters.propertyKinds?.some(k => k !== "non_residential") || filters.purposes.includes("residential"));
}
