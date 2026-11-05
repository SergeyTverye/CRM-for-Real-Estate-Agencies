import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateListing, evaluateFeature } from "../../src/modules/property-search/domain/evaluation";
import { residentialPurposeContradiction } from "../../src/modules/property-search/domain/purpose";
import { parseFloor } from "../../src/modules/property-search/domain/floor";
import { deduplicateListings, listingIdentity, parsePriceUnit } from "../../src/modules/property-search/infrastructure/normalization";
import type { NormalizedListing } from "../../src/modules/property-search/domain/types";
import { loadDataset, fingerprint, baselinePath, reportPath, type Verdict } from "./dataset";

export interface DuplicatePrediction { a: string; b: string; relation: "suspected" | "exact" }
/** Plug a future domain grouping function into this seam; the gold groups stay unchanged. */
export type GroupingAdapter = (input: { id: string; listing: NormalizedListing }[]) => { pairs: DuplicatePrediction[]; retained: number };
export const currentGrouping: GroupingAdapter = input => {
  const retained = deduplicateListings(input.map(x => x.listing));
  const pairs: DuplicatePrediction[] = [];
  for (let i = 0; i < input.length; i++) for (let j = i + 1; j < input.length; j++) {
    const a = input[i]!, b = input[j]!;
    const keyA = listingIdentity(a.listing), keyB = listingIdentity(b.listing);
    const result = retained.find(r => r.url === a.listing.url);
    if (keyA && keyA === keyB) pairs.push({ a: a.id, b: b.id, relation: "exact" });
    else if (result?.possibleDuplicateKeys.includes(keyB ?? b.listing.url)) pairs.push({ a: a.id, b: b.id, relation: "suspected" });
  }
  return { pairs, retained: retained.length };
};
const rate = (a: number, b: number) => b ? Number((a / b).toFixed(6)) : null;
const emptyMetrics = () => ({ cases: 0, expectedRejected: 0, expectedIncluded: 0, falseInclusions: 0, falseConfirmed: 0, falseNeedsReview: 0, falseExclusions: 0, exactVerdictErrors: 0 });
export function evaluateQuality(grouping: GroupingAdapter = currentGrouping, evaluator = evaluateListing) {
  const data = loadDataset();
  const totals = emptyMetrics();
  const perQuery: Record<string, ReturnType<typeof emptyMetrics>> = {};
  const perSource: Record<string, ReturnType<typeof emptyMetrics>> = {};
  const errors: { id: string; query: string; expected: Verdict; actual: Verdict; kind: string; url: string; reason: string; criteria: { criterion: string; state: string; evidence: string }[] }[] = [];
  for (const query of data.queries) {
    perQuery[query.id] = emptyMetrics();
    for (const item of data.listings) {
      const actual = evaluator(item.listing, query.filters);
      const expected = item.expected[query.id]!;
      const inclusion = expected === "rejected" && actual.verdict !== "rejected";
      const exclusion = expected !== "rejected" && actual.verdict === "rejected";
      const sourceMetrics = perSource[item.input.source] ??= emptyMetrics();
      for (const m of [totals, perQuery[query.id]!, sourceMetrics]) {
        m.cases++;
        if (expected === "rejected") m.expectedRejected++; else m.expectedIncluded++;
        if (inclusion) { m.falseInclusions++; if (actual.verdict === "confirmed") m.falseConfirmed++; else m.falseNeedsReview++; }
        if (exclusion) m.falseExclusions++;
        if (expected !== actual.verdict) m.exactVerdictErrors++;
      }
      if (expected !== actual.verdict) errors.push({ id: item.id, query: query.id, expected, actual: actual.verdict, kind: inclusion ? "false_inclusion" : exclusion ? "false_exclusion" : "review_boundary", url: item.input.url, reason: item.truth.reason, criteria: actual.criteria });
    }
  }
  const prediction = grouping(data.listings.map(x => ({ id: x.id, listing: x.listing })));
  const key = (a: string, b: string) => [a, b].sort().join(":");
  const predictions = new Map(prediction.pairs.map(p => [key(p.a, p.b), p]));
  let tp = 0, fp = 0, fn = 0, tn = 0, unknown = 0;
  const scoredKeys = new Set<string>();
  for (const pair of data.duplicatePairs) {
    if (pair.expected === "unknown") { unknown++; continue; }
    scoredKeys.add(key(pair.a, pair.b));
    const predicted = predictions.has(key(pair.a, pair.b));
    if (pair.expected === "suspected") { if (predicted) tp++; else fn++; }
    else if (predicted) fp++; else tn++;
  }
  const floors = data.listings.filter(x => x.truth.floor.contradicted).map(x => {
    const actual = parseFloor(x.listing.floor.raw);
    const raw = x.truth.floor.raw!;
    const expected = raw === "цоколь" ? { kind: "semi_basement", number: null } : { kind: "above_ground", number: Number(raw) };
    return { id: x.id, url: x.input.url, expected, actual, correct: actual.kind === expected.kind && actual.number === expected.number };
  });
  const units = data.listings.filter(x => x.truth.price.explicitUnit).map(x => ({ id: x.id, expected: x.truth.price.explicitUnit, actual: parsePriceUnit(x.input.description, x.truth.operation === "sale" ? "sale" : "rent") }));
  const featureRequests: Record<string, string> = { separate_entrance: "отдельный вход", wet_point: "мокрая точка", gates: "ворота", first_line: "первая линия" };
  const features = data.listings.flatMap(x => Object.entries(x.truth.features).flatMap(([name, value]) => {
    if (typeof value !== "boolean" || !featureRequests[name]) return [];
    const actual = evaluateFeature(featureRequests[name], x.listing);
    return [{ id: x.id, feature: name, expected: value ? "matched" : "contradicted", actual: actual.state }];
  }));
  const residential = data.listings.filter(x => x.truth.trueType === "residential");
  const unknownDates = data.listings.filter(x => !x.truth.publicationDateKnown).length;
  const composition = (field: "source" | "trueType" | "recordKind") => Object.fromEntries([...new Set(data.listings.map(x => field === "source" ? x.input.source : x.truth[field]))].map(value => [value, data.listings.filter(x => (field === "source" ? x.input.source : x.truth[field]) === value).length]));
  return {
    mode: "REPLAY", sourceMode: "LIVE", collectedOn: data.collectedOn, networkCalls: 0, aiCalls: 0,
    fixtureFingerprint: fingerprint(),
    codeFingerprint: createHash("sha256").update(["domain/evaluation.ts", "domain/purpose.ts", "domain/types.ts", "domain/floor.ts", "infrastructure/normalization.ts"].map(p => readFileSync(resolve("src/modules/property-search", p))).reduce((a, b) => Buffer.concat([a, b]), Buffer.alloc(0))).digest("hex"),
    composition: { total: data.listings.length, bySource: composition("source"), byTrueType: composition("trueType"), byRecordKind: composition("recordKind"), populationUniqueUrls: data.populationUniqueUrls },
    totals: { ...totals, falseInclusionRate: rate(totals.falseInclusions, totals.expectedRejected), falseExclusionRate: rate(totals.falseExclusions, totals.expectedIncluded) },
    perQuery, perSource,
    dates: { unknown: unknownDates, total: data.listings.length, share: rate(unknownDates, data.listings.length), knownPublicationDates: data.listings.length - unknownDates },
    deduplication: { tp, fp, fn, tn, precision: rate(tp, tp + fp), recall: rate(tp, tp + fn), annotatedPairs: scoredKeys.size, unknownPairsExcluded: unknown, unlabelledPredictions: prediction.pairs.filter(p => !scoredKeys.has(key(p.a, p.b))).length, retained: prediction.retained, exactMergeAccuracy: null, predictions: prediction.pairs },
    diagnostics: { residentialPurposeRule: { total: residential.length, rejected: residential.filter(x => residentialPurposeContradiction(x.listing) !== null).length }, floorNormalization: floors, priceUnitNormalization: units, features },
    errors,
  };
}
export type QualityReport = ReturnType<typeof evaluateQuality>;

export function renderReport(baseline: QualityReport, current: QualityReport) {
  const data = loadDataset();
  const table = (r: QualityReport) => ["| Запрос | Проверок | Должны отклоняться | Должны включаться | Ложные включения (confirmed / review) | Ложные исключения | Ошибки точного вердикта |", "|---|---:|---:|---:|---:|---:|---:|", ...Object.entries(r.perQuery).map(([id, m]) => `| ${id} | ${m.cases} | ${m.expectedRejected} | ${m.expectedIncluded} | ${m.falseInclusions} (${m.falseConfirmed} / ${m.falseNeedsReview}) | ${m.falseExclusions} | ${m.exactVerdictErrors} |`)].join("\n");
  return `# Проверка качества поиска — AT-01, AT-07, AT-08\n\nДанные **LIVE**, получены при испытаниях **05.11.2026**; этот прогон **REPLAY**, без сети, БД и AI. Новых живых запросов нет. Это базовая линия качества, а не PASS всей приёмки AT-01/07/08.\n\n## Методика и состав\n\nОтобраны ${data.listings.length} записей: 46 карточек объявлений и 3 отрицательных контроля — страницы выдачи (L45–L47). Источник — read-only выборка crm_demo: ExternalListing → ExternalListingSnapshot → SearchRun и SearchRunResult, только run ID из docs/vkr/live-ai-evidence.json. В этих запусках ${data.populationUniqueUrls} уникальных URL; ранее 591 — число результатов по запускам, а не уникальных объявлений. Синтетические объявления исключены. SHA256 исходного evidence сохранён в фикстуре; UUID служат только трассировке происхождения.\n\nИсточники: ${JSON.stringify(current.composition.bySource)}. Истинное назначение: ${JSON.stringify(current.composition.byTrueType)}. Web Search — способ получения страниц, а не дополнительная площадка с проверенными карточками. Реальных карточек Авито/Циан/Домклик в этих данных нет; их заменять синтетикой нельзя.\n\nРазметка в annotations.ts введена вручную после чтения текста/полей, независимо от evaluateListing. Проверены коммерческий тип, операция, цена/единица, площадь, этаж, явно названные признаки, дата, вероятная дубль-группа и четыре ожидаемых вердикта. commercial — подтверждённое назначение по объявлению; residential — явно жилое; mixed — коммерческое/неопределённое помещение в жилом окружении; unknown — недостаточно фактов (включая апартаменты с неизвестным юридическим статусом). mixed не означает автоматическое отклонение.\n\nЦена из поля не считается независимо проверенной: amount_unverified_from_excerpt. Отдельно отмечены явные цена/единица; 100 ₽/м² за первый месяц у L16 не равно 100 ₽ за весь объект. Неизвестный период аренды → needs_review. Поле площади — наблюдение источника, не обмер; конфликт/округление отмечен. Отсутствие упоминания витрины, входа, ворот не означает false; пустая features означает unknown. Будущий вход на согласовании не считается существующим.\n\nТексты обезличены, сокращены до 300 символов; URL сохранены, фото и контакты исключены. Заголовков в старых снимках нет (title=null), они не выдуманы. Оценивается именно эта фиксированная сокращённая проекция, а не полный текст страницы. Возможные доказательства за её пределами не учитываются. Старые снимки не содержат purposeSource; отсутствие сохранено, чтобы не скрыть фактическое поведение правила. Web Search source проецируется в код площадки только для совместимости доменного типа; исходный код остаётся в input.source.\n\n### Запросы\n\n${data.queries.map(q => `- **${q.id}**: ${q.label}.`).join("\n")}\n\nЭталонный confirmed требует отсутствия неизвестных обязательных условий; needs_review — коммерчески правдоподобный кандидат с неизвестными условиями; rejected — явное противоречие или страница выдачи вместо конкретного лота. ПСН без явного офисного назначения требует уточнения для офиса. Юридически квартира отклоняется, даже если предлагается как готовый офис. Чисто жилой текст ЖК без доказательства коммерческого лота считается ложным коммерческим совпадением.\n\nЛожное включение: expected=rejected, actual=confirmed/needs_review (считаются отдельно). Ложное исключение: expected=confirmed/needs_review, actual=rejected. Доли: соответственно от всех expectedRejected и expectedIncluded, не от всего набора. Ошибки точного вердикта дополнительно учитывают confirmed ↔ needs_review.\n\n## Базовая линия до v3.1\n\nБазовая линия заморожена в baseline.json. Отпечаток кода: \`${baseline.codeFingerprint}\`.\n\n${table(baseline)}\n\nВсего ${baseline.totals.cases} пар объявление × запрос. Ложных включений **${baseline.totals.falseInclusions}/${baseline.totals.expectedRejected}**, исключений **${baseline.totals.falseExclusions}/${baseline.totals.expectedIncluded}**. Точное несовпадение вердикта: ${baseline.totals.exactVerdictErrors}. Неизвестных дат публикации: **${baseline.dates.unknown}/${baseline.dates.total}** (${100 * (baseline.dates.share ?? 0)}%). fetchedAt/firstSeenAt не подменяют публикацию.\n\nДубли: TP=${baseline.deduplication.tp}, FP=${baseline.deduplication.fp}, FN=${baseline.deduplication.fn}, TN=${baseline.deduplication.tn}; precision=${baseline.deduplication.precision ?? "N/A (нет предсказаний)"}, recall=${baseline.deduplication.recall}. Это качество обнаружения **подозреваемых пар** по 3 положительным и 2 отрицательным разметкам, а не доказанная тождественность объектов. Три спорные пары исключены из знаменателя; остальные неразмеченные пары не считаются отрицательными. Accuracy точного объединения = N/A: эталонных доказанных межплощадочных дублей нет. Сохранены ${baseline.deduplication.retained} источников.\n\n### Главные классы ошибок и примеры\n\n${baseline.errors.filter((e, i, all) => all.findIndex(x => x.id === e.id && x.kind === e.kind) === i).map(e => `- [${e.id}](${e.url}), ${e.query}: ${e.expected} → ${e.actual} (${e.kind}). ${e.reason}`).join("\n")}\n\nДополнительные диагностические прогоны вызывают текущее purpose-правило, parseFloor, parsePriceUnit и evaluateFeature. Четыре конфликтных этажа (L19, L23, L33, L48) сравниваются с ручной разметкой; parseFloor работает с ошибочным исходным floorRaw и не читает описание. Для L16/L27 цена проверяется по явному тексту. Это проверки нормализации имеющихся полей, не повторный парсинг HTML: сырой HTML/package Listing в старой БД не сохранён. Полный normalizeListing без исходного raw не воспроизводим; выдуманного raw нет.\n\nУ пяти жилых примеров purpose-правило не даёт отрицательного критерия (0/5): старые снимки содержат purpose=office, но не содержат purposeSource. Текущий early return доверяет этому полю как структурированному; коммерческая формулировка также может маскировать юридически жилой статус (L26). Отдельный класс — страницы выдачи L45–L47, которые общий оценщик пропускает как needs_review при неизвестных полях. Эти результаты относятся к replay старых снимков, а не к доказанной точности нового парсинга.\n\nВероятные дубли D01–D03 пропускаются при строгом сравнении адресов (город/сокращения/номер дома). Совпадения одной цены/площади недостаточно для auto-merge.\n\n## Ограничения и дальнейшие проверки\n\n- В исходном срезе нет подтверждённых положительных примеров аренды торговли на первом этаже: retail-rent проверяет отрицательные/неопределённые случаи, полноту положительной выдачи не доказывает. Есть явное торговое использование ПСН L31/L33/L43.\n- Все даты неизвестны: набор обнаруживает отсутствие publication date, но не проверяет точность разбора известных дат и свежести.\n- Неизвестные цена/площадь представлены страницами выдачи, не реальными карточками с пропущенными полями; положительное поведение таких карточек требует следующего LIVE среза.\n- Разметка одним агентом по сохранённым публичным фрагментам — экспертная интерпретация для регрессии, без независимой проверки человеком/документов объекта.\n- AT-08 здесь проверяет доменные вердикты без AI. Платный анализ, интерфейс сравнения и ограниченный LIVE smoke остаются у соответствующих агентов.\n\n## Воспроизведение и защита от регрессии\n\n\`npx tsx scripts/search-quality/evaluate.ts\` — таблица и JSON в stdout; \`--write\` обновляет этот отчёт, сохраняя baseline.json. \`npx vitest run --project unit tests/unit/property-search/quality-baseline.test.ts\` — «не хуже» по каждому запросу и источнику: отдельно falseConfirmed, falseInclusions, falseExclusions, exactVerdictErrors (число falseNeedsReview выводится отдельно; downgrade ошибочного confirmed → needs_review разрешён); по дублям FP/FN не растут, TP/TN не падают. Менять пороги вместе с поисковым исправлением нельзя. Фикстура и ручная разметка защищены fingerprint.\n\nДля намеренного нового эталона: отдельное review разметки, затем явный \`--freeze-baseline --write\`. Обычный прогон никогда не перезаписывает пороги. GroupingAdapter позволяет подключить будущую функцию группировки.\n\n## Текущий REPLAY\n\n${table(current)}\n\n### JSON: замороженная базовая линия\n\n\`\`\`json\n${JSON.stringify(baseline, null, 2)}\n\`\`\`\n\n### JSON: текущий результат\n\n\`\`\`json\n${JSON.stringify(current, null, 2)}\n\`\`\`\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const current = evaluateQuality();
  if (process.argv.includes("--freeze-baseline")) writeFileSync(baselinePath, JSON.stringify(current, null, 2) + "\n");
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as QualityReport;
  console.table(Object.entries(current.perQuery).map(([query, m]) => ({ query, ...m })));
  if (process.argv.includes("--write")) writeFileSync(reportPath, renderReport(baseline, current));
  console.log(JSON.stringify(current, null, 2));
}
