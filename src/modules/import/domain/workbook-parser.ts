import { createHash } from "node:crypto";
import type { ImportProfile } from "./profiles";
import { normalizeHeader } from "./profiles";
import { cellText, contactKind, dateFromParts, normalizeAddress, parseDate, parseInteger, parseNumber, type Cell } from "./normalize";

/**
 * Разбор листа с несколькими логическими реестрами (ТЗ 38.1–38.7).
 * Секции определяются по сигнатуре «marker + ожидаемые заголовки», а не по номерам строк.
 * Конвейер строки: parse → normalize → policy filter → validate → (дубли — в application) → candidate mapping.
 * Значения исключённых политикой колонок отбрасываются на этапе parse и дальше не передаются.
 */

export interface SheetData {
  name: string;
  rows: Cell[][]; // rows[i] — строка i+1 листа
}

export interface ColumnRef {
  index: number;
  header: string;
}

export interface DetectedSection {
  sectionKey: string;
  profileCode: string | null;
  candidateProfiles: string[];
  sheetName: string;
  markerRow: number;
  markerText: string;
  headerRow: number | null;
  firstDataRow: number;
  lastRow: number;
  status: "recognized" | "unrecognized";
  columns: (ColumnRef & { field: string })[];
  excludedColumns: ColumnRef[];
  unresolvedColumns: ColumnRef[];
  unknownColumns: ColumnRef[];
}

export type ValidationStatus = "ready" | "warning" | "skipped_policy" | "invalid" | "unrecognized";

export interface ParsedRow {
  sheetName: string;
  sectionKey: string;
  profileCode: string | null;
  rowNumber: number;
  recordKey: string;
  target: ImportProfile["target"] | null;
  validationStatus: ValidationStatus;
  errorCodes: string[];
  warningCodes: string[];
  /** Нормализованная запись для commit. без исключённых политикой полей. */
  record: Record<string, unknown>;
  /** Признаки для поиска дублей. */
  dedupe: { phones: string[]; emails: string[]; addressKey: string | null; archiveKey: string | null };
}

const nonEmpty = (row: Cell[] | undefined) => (row ?? []).filter((c) => cellText(c) !== "").length;

function matchesHeader(header: string, key: string): boolean {
  const k = normalizeHeader(key);
  return header === k || header.startsWith(`${k} `) || header.startsWith(`${k}(`);
}

function findMarkerProfiles(row: Cell[], profiles: ImportProfile[]): { text: string; profiles: ImportProfile[] } | null {
  if (nonEmpty(row) === 0 || nonEmpty(row) > 3) return null;
  const text = row.map((c) => cellText(c)).filter(Boolean).join(" ");
  const norm = normalizeHeader(text);
  const hits = profiles.filter((p) => p.markers.some((m) => norm.includes(normalizeHeader(m))));
  return hits.length ? { text, profiles: hits } : null;
}

export function detectSections(sheets: SheetData[], profiles: ImportProfile[]): DetectedSection[] {
  const sections: DetectedSection[] = [];
  for (const sheet of sheets) {
    const markers: { row: number; text: string; profiles: ImportProfile[] }[] = [];
    sheet.rows.forEach((r, i) => {
      const m = findMarkerProfiles(r, profiles);
      if (m) markers.push({ row: i + 1, ...m });
    });
    markers.forEach((m, mi) => {
      const sectionEnd = (markers[mi + 1]?.row ?? sheet.rows.length + 1) - 1;
      let headerRow: number | null = null;
      for (let r = m.row + 1; r <= Math.min(m.row + 5, sectionEnd); r++) {
        if (nonEmpty(sheet.rows[r - 1]) >= 2) {
          headerRow = r;
          break;
        }
      }
      const headers = headerRow ? (sheet.rows[headerRow - 1] ?? []).map((c) => normalizeHeader(c)) : [];
      const profile = headerRow ? m.profiles.find((p) => p.requiredHeaders.every((req) => headers.some((h) => matchesHeader(h, req)))) ?? null : null;
      const section: DetectedSection = {
        sectionKey: `${sheet.name}!${m.row}`,
        profileCode: profile?.code ?? null,
        candidateProfiles: m.profiles.map((p) => p.code),
        sheetName: sheet.name,
        markerRow: m.row,
        markerText: m.text,
        headerRow,
        firstDataRow: (headerRow ?? m.row) + 1,
        lastRow: sectionEnd,
        status: profile ? "recognized" : "unrecognized",
        columns: [],
        excludedColumns: [],
        unresolvedColumns: [],
        unknownColumns: [],
      };
      const usedFields = new Set<string>();
      headers.forEach((h, index) => {
        if (!h) return;
        const original = cellText((sheet.rows[headerRow! - 1] ?? [])[index]);
        const p = profile ?? m.profiles[0]!;
        if (p.excludedByPolicy.some((x) => matchesHeader(h, x) || h.includes(normalizeHeader(x)))) {
          section.excludedColumns.push({ index, header: original });
          return;
        }
        if (!profile) {
          section.unknownColumns.push({ index, header: original });
          return;
        }
        const key = Object.keys(profile.columns).find((k) => normalizeHeader(k) === h) ?? Object.keys(profile.columns).find((k) => matchesHeader(h, k));
        if (key && !usedFields.has(profile.columns[key]!)) {
          usedFields.add(profile.columns[key]!);
          section.columns.push({ index, header: original, field: profile.columns[key]! });
        } else if (profile.unresolved.some((u) => normalizeHeader(u) === h)) section.unresolvedColumns.push({ index, header: original });
        else section.unknownColumns.push({ index, header: original });
      });
      sections.push(section);
    });
  }
  return sections;
}

export function sha256(s: string | Buffer): string {
  return createHash("sha256").update(s).digest("hex");
}

const OP_TEXT: [RegExp, string][] = [
  [/аренд|сда/, "rent"],
  [/прод|куп/, "sale"],
];
const TYPE_TEXT: [RegExp, string][] = [
  [/жил|кварт|комнат/, "residential"],
  [/ком|офис|торг|склад|псн|помещ/, "commercial"],
  [/зем|участ/, "land"],
  [/дом|дач|коттедж|загор/, "country"],
];

function mapText(text: string, table: [RegExp, string][]): string | null {
  const t = text.toLowerCase();
  return table.find(([re]) => re.test(t))?.[1] ?? null;
}

const URL_RE = /^https?:\/\/\S+$/i;

/**
 * Обработка строк секции. Вызывающий код получает ParsedRow без значений исключённых колонок.
 * fileSha участвует в ключе исходной записи (идемпотентность повторного commit того же файла).
 */
export function parseSectionRows(sheet: SheetData, section: DetectedSection, profile: ImportProfile | null, fileSha: string): ParsedRow[] {
  const out: ParsedRow[] = [];
  for (let r = section.firstDataRow; r <= section.lastRow; r++) {
    const row = sheet.rows[r - 1] ?? [];
    if (nonEmpty(row) === 0) continue;
    const recordKey = sha256(`${fileSha}|${section.profileCode ?? section.candidateProfiles.join("/")}|${sheet.name}|${r}`);
    const base: ParsedRow = {
      sheetName: sheet.name,
      sectionKey: section.sectionKey,
      profileCode: section.profileCode,
      rowNumber: r,
      recordKey,
      target: profile?.target ?? null,
      validationStatus: "ready",
      errorCodes: [],
      warningCodes: [],
      record: {},
      dedupe: { phones: [], emails: [], addressKey: null, archiveKey: null },
    };
    if (!profile || section.status !== "recognized") {
      out.push({ ...base, validationStatus: "unrecognized", warningCodes: ["section_needs_mapping"] });
      continue;
    }
    // parse + policy filter: исключённые колонки не читаются в запись, отмечается только факт.
    const raw: Record<string, Cell> = {};
    for (const c of section.columns) raw[c.field] = row[c.index] ?? null;
    const excludedHadValues = section.excludedColumns.some((c) => cellText(row[c.index]) !== "");
    const mappedNonEmpty = section.columns.filter((c) => cellText(row[c.index]) !== "").length;
    if (excludedHadValues) base.warningCodes.push("policy_fields_excluded");
    if (mappedNonEmpty === 0) {
      out.push({ ...base, validationStatus: excludedHadValues ? "skipped_policy" : "unrecognized", warningCodes: excludedHadValues ? base.warningCodes : ["comment_or_separator"] });
      continue;
    }
    if (mappedNonEmpty === 1 && nonEmpty(row) === 1 && section.columns.length > 2) {
      out.push({ ...base, validationStatus: "unrecognized", warningCodes: ["comment_or_separator"] });
      continue;
    }
    if (section.unresolvedColumns.some((c) => cellText(row[c.index]) !== "")) base.warningCodes.push("unresolved_fields_ignored");

    const t = (f: string) => cellText(raw[f] ?? null);
    const num = (f: string, code: string) => {
      if (t(f) === "") return null;
      const n = parseNumber(raw[f]);
      if (n === null) base.warningCodes.push(code);
      return n;
    };

    switch (profile.target) {
      case "historical_deal_archive": {
        let dealDate = raw.dealDate !== undefined ? parseDate(raw.dealDate) : null;
        if (!dealDate && (t("dealYear") || t("dealMonth"))) dealDate = dateFromParts(raw.dealYear, raw.dealMonth, raw.dealDay);
        if (!dealDate && (t("dealDate") || t("dealYear"))) base.warningCodes.push("invalid_date");
        const phone = t("contactPhone") ? contactKind(t("contactPhone")) : null;
        const rec = {
          sourceRowId: t("sourceRowId") || null,
          dealDate,
          dealDateText: [t("dealDate"), t("dealYear"), t("dealMonth"), t("dealDay")].filter(Boolean).join(" ") || null,
          propertyType: t("propertyType") || null,
          objectText: [t("objectText"), t("roomsOrType"), t("floor"), t("extra")].filter(Boolean).join(", ") || null,
          partyRole: t("partyRole") || null,
          participantName: t("participantName") || null,
          contactPhone: phone?.type === "phone" ? phone.normalized : null,
          contactEmail: phone?.type === "email" ? phone.normalized : null,
          area: num("area", "invalid_area"),
          price: num("price", "invalid_price"),
          conditions: t("conditions") || null,
          realtorText: t("realtorText") || null,
          contractRef: t("contractRef") || null,
          commissionAmount: num("commissionAmount", "invalid_commission"),
          additionalInfo: [t("additionalInfo"), t("commissionReceived") ? `Поступление: ${t("commissionReceived")}` : ""].filter(Boolean).join("; ") || null,
        };
        if (t("contactPhone") && !phone?.normalized) base.warningCodes.push("invalid_phone");
        if (!t("objectText") && !rec.participantName) base.errorCodes.push("missing_required");
        base.record = rec;
        base.dedupe.archiveKey = sha256(
          [rec.dealDate?.toISOString().slice(0, 10) ?? rec.dealDateText ?? "", (rec.participantName ?? "").toLowerCase(), normalizeAddress(rec.objectText ?? ""), rec.price ?? ""].join("|"),
        );
        if (rec.contactPhone) base.dedupe.phones.push(rec.contactPhone);
        break;
      }
      case "property": {
        const propertyType = profile.defaults.propertyType ?? mapText(t("propertyTypeText"), TYPE_TEXT);
        const operationType = profile.defaults.operationType ?? mapText(t("operationText"), OP_TEXT);
        const rec: Record<string, unknown> = {
          addressText: t("addressText") || null,
          district: t("district") || null,
          area: num("area", "invalid_area"),
          price: num("price", "invalid_price"),
          floor: t("floor") ? parseInteger(raw.floor) : null,
          floorsTotal: t("floorsTotal") ? parseInteger(raw.floorsTotal) : null,
          roomsCount: t("roomsCount") ? parseInteger(raw.roomsCount) : null,
          description: t("description") || null,
          adText: t("adText") || null,
          adUrl: null as string | null,
          adPlatformText: t("adPlatformText") || null,
          propertyType,
          operationType,
          sourceType: profile.defaults.sourceType ?? "agency_listing",
          sourceUrl: null as string | null,
          owner: null as null | { name: string; phone: string },
          // Поля без однозначного структурного аналога сохраняются в attributes_jsonb, а не теряются молча.
          extraAttributes: Object.fromEntries(
            ([["purposeText", "commercialPurpose"], ["realtorText", "realtorText"], ["listedDate", "listedDate"]] as const)
              .map(([k, f]) => [k, t(f)])
              .filter(([, v]) => v),
          ),
        };
        if (!rec.addressText) base.errorCodes.push("missing_address");
        if (!propertyType || !operationType) base.errorCodes.push("unknown_type_or_operation");
        if (t("adUrl")) {
          if (URL_RE.test(t("adUrl"))) {
            // Внешний рыночный объект: ссылка — источник, а не реклама агентства (ТЗ 40.3).
            if (rec.sourceType === "external_market") rec.sourceUrl = t("adUrl");
            else rec.adUrl = t("adUrl");
          } else base.warningCodes.push("invalid_url");
        }
        if (t("ownerName") || t("ownerPhone")) {
          const ph = contactKind(t("ownerPhone"));
          if (t("ownerName") && ph.type === "phone") {
            rec.owner = { name: t("ownerName"), phone: ph.normalized! };
            base.dedupe.phones.push(ph.normalized!);
          } else base.warningCodes.push("owner_ambiguous");
        }
        if (rec.description && /(\+7|8)[\s(-]*\d{3}/.test(String(rec.description))) {
          rec.description = String(rec.description).replace(/(\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g, "[телефон удалён]");
          base.warningCodes.push("phone_removed_from_description");
        }
        base.record = rec;
        base.dedupe.addressKey = rec.addressText ? normalizeAddress(String(rec.addressText)) : null;
        break;
      }
      case "client_request_need": {
        const received = parseDate(raw.receivedDate);
        if (t("receivedDate") && !received) base.warningCodes.push("invalid_received_date");
        const updated = parseDate(raw.updatedDate);
        const fn = t("functionText").toLowerCase();
        const operationType = Object.entries(profile.functionMap ?? {}).find(([k]) => fn.includes(k))?.[1] ?? null;
        if (fn && !operationType) base.warningCodes.push("unknown_function");
        const state = t("stateMark").toLowerCase();
        const needStatus = Object.entries(profile.stateMap ?? {}).find(([k]) => state.includes(k))?.[1] ?? "active";
        const coord = t("coordinates");
        const ck = coord ? contactKind(coord) : null;
        if (ck?.normalized) (ck.type === "phone" ? base.dedupe.phones : base.dedupe.emails).push(ck.normalized);
        const rec = {
          name: t("name") || null,
          receivedAt: received,
          lastActivityAt: updated,
          operationType,
          needStatus,
          coordinatesRaw: coord || null,
          coordinatesKind: ck?.type ?? null,
          coordinatesNormalized: ck?.normalized ?? null,
          comment: t("comment") || null,
          propertyType: profile.defaults.propertyType ?? "commercial",
          channelCode: profile.defaults.channelCode ?? "other",
          sourceCode: profile.defaults.sourceCode ?? "other",
        };
        if (!rec.name) base.errorCodes.push("missing_name");
        if (!coord) base.warningCodes.push("no_contact");
        base.record = rec;
        break;
      }
      case "property_agreement_control": {
        const presence = t("agreementPresence").toLowerCase();
        const has = /^(да|есть|\+|имеется)/.test(presence) ? true : /^(нет|отсутств|-)/.test(presence) ? false : null;
        if (presence && has === null) base.warningCodes.push("ambiguous_agreement_presence");
        const rec: Record<string, unknown> = {
          addressText: t("addressText") || null,
          area: num("area", "invalid_area"),
          price: num("price", "invalid_price"),
          adText: t("adText") || null,
          adUrl: URL_RE.test(t("adUrl")) ? t("adUrl") : null,
          agreementPresent: has,
          absenceReason: t("absenceReason") || null,
          commissionFrom: num("commissionFrom", "invalid_commission"),
          commissionTo: num("commissionTo", "invalid_commission"),
          fixNote: t("fixNote") || null,
          taskText: t("taskText") || null,
          actuality: t("actuality") || null,
          propertyType: profile.defaults.propertyType ?? "commercial",
          operationType: profile.defaults.operationType ?? "rent",
          sourceType: profile.defaults.sourceType ?? "agency_listing",
        };
        if (t("adUrl") && !rec.adUrl) base.warningCodes.push("invalid_url");
        if (!rec.addressText) base.errorCodes.push("missing_address");
        base.record = rec;
        base.dedupe.addressKey = rec.addressText ? normalizeAddress(String(rec.addressText)) : null;
        break;
      }
    }
    base.validationStatus = base.errorCodes.length ? "invalid" : base.warningCodes.filter((w) => w !== "policy_fields_excluded").length ? "warning" : "ready";
    out.push(base);
  }
  return out;
}

/** Финальный статус с учётом дублей (probable_duplicate не заменяет основной статус, ТЗ 38.7). */
export function withWarning(row: ParsedRow, code: string): ParsedRow {
  if (row.warningCodes.includes(code)) return row;
  const warningCodes = [...row.warningCodes, code];
  return { ...row, warningCodes, validationStatus: row.validationStatus === "ready" ? "warning" : row.validationStatus };
}
