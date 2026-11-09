import { labelOf } from "@/shared/codebook";
import { dictLabel, type Dictionaries } from "@/modules/dictionaries/application/dictionaries-service";
import { fmtMoney, fmtNum } from "@/server/format";
import { Dl } from "../components";

/** Серверное отображение параметров потребности (карточка, рабочее место подбора, списки). */

type Num = { toString(): string } | number | null | undefined;

export interface NeedParamsLike {
  operationType: string;
  propertyType: string;
  propertySubtype: string | null;
  financingType: string | null;
  mortgageStatus: string | null;
  budgetMin: Num;
  budgetMax: Num;
  district: string | null;
  locationText: string | null;
  areaMin: Num;
  areaMax: Num;
  commercialPurpose: string | null;
  floorMin: number | null;
  floorMax: number | null;
  roomsMin: number | null;
  roomsMax: number | null;
  landAreaMin: Num;
  landAreaMax: Num;
  buildingAreaMin: Num;
  buildingAreaMax: Num;
  powerRequirement: Num;
  parkingRequirement: boolean | null;
  tenantRequirement: boolean | null;
  notes: string | null;
}

const present = (v: Num) => v !== null && v !== undefined && v.toString() !== "";

/** «от a до b» / «от a» / «до b». null — параметр не задан. */
export function fmtRange(min: Num, max: Num, fmt: (v: Num) => string): string | null {
  const a = present(min);
  const b = present(max);
  if (a && b) return `${fmt(min)} – ${fmt(max)}`;
  if (a) return `от ${fmt(min)}`;
  if (b) return `до ${fmt(max)}`;
  return null;
}

const money = (v: Num) => fmtMoney(v ?? null);
const area = (v: Num) => fmtNum(v ?? null, "м²");

/** Заголовок потребности: «Купить · Коммерческая · Офис». */
export function needTitle(dicts: Dictionaries, n: Pick<NeedParamsLike, "operationType" | "propertyType" | "propertySubtype">): string {
  return [dictLabel(dicts, "need_operation_type", n.operationType), dictLabel(dicts, "property_type", n.propertyType), n.propertySubtype ? dictLabel(dicts, "property_subtype", n.propertySubtype) : null]
    .filter(Boolean)
    .join(" · ");
}

/** Краткая строка запроса для списков: «район · бюджет · площадь». */
export function needBriefLine(n: Pick<NeedParamsLike, "district" | "budgetMin" | "budgetMax" | "areaMin" | "areaMax">): string {
  return [n.district, fmtRange(n.budgetMin, n.budgetMax, money), fmtRange(n.areaMin, n.areaMax, area)].filter(Boolean).join(" · ");
}

export function NeedParamsSummary({ need: n, dicts }: { need: NeedParamsLike; dicts: Dictionaries }) {
  const extras: string[] = [];
  const rooms = fmtRange(n.roomsMin, n.roomsMax, (v) => String(v));
  if (rooms) extras.push(`комнат ${rooms}`);
  const floor = fmtRange(n.floorMin, n.floorMax, (v) => String(v));
  if (floor) extras.push(`этаж ${floor}`);
  if (n.commercialPurpose) extras.push(`назначение: ${dictLabel(dicts, "commercial_purpose", n.commercialPurpose)}`);
  if (present(n.powerRequirement)) extras.push(`мощность от ${fmtNum(n.powerRequirement ?? null, "кВт")}`);
  if (n.parkingRequirement !== null) extras.push(n.parkingRequirement ? "нужна парковка" : "без парковки");
  if (n.tenantRequirement !== null) extras.push(n.tenantRequirement ? "с арендатором" : "без арендатора");
  const land = fmtRange(n.landAreaMin, n.landAreaMax, (v) => fmtNum(v ?? null, "сот."));
  if (land) extras.push(`участок ${land}`);
  const building = fmtRange(n.buildingAreaMin, n.buildingAreaMax, area);
  if (building) extras.push(`дом/здание ${building}`);
  const mortgage = n.financingType === "mortgage" || n.financingType === "mixed";

  return (
    <Dl
      items={[
        ["Тип объекта", needTitle(dicts, n)],
        ["Бюджет", fmtRange(n.budgetMin, n.budgetMax, money)],
        ["Район / локация", [n.district, n.locationText].filter(Boolean).join(" — ") || null],
        ["Площадь", fmtRange(n.areaMin, n.areaMax, area)],
        ["Финансирование", n.financingType ? labelOf("financingType", n.financingType) : null],
        ...(mortgage ? ([["Статус ипотеки", labelOf("mortgageStatus", n.mortgageStatus)]] as [React.ReactNode, React.ReactNode][]) : []),
        ["Доп. требования", extras.length ? extras.join("; ") : null],
        ["Комментарий", n.notes ? <span className="whitespace-pre-line">{n.notes}</span> : null],
      ]}
    />
  );
}
