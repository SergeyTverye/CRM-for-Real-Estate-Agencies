import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/page-auth";
import { getNeedCard } from "@/modules/needs/application/need-queries";
import { findCandidates } from "@/modules/matching/application/matching-service";
import { NotFoundError, ValidationError } from "@/shared/errors";
import { labelOf } from "@/shared/codebook";
import { searchParamsToObject } from "@/shared/validation";
import { dictLabel } from "@/modules/dictionaries/application/dictionaries-service";
import { fmtDate, fmtMoney, fmtNum } from "@/server/format";
import { codeOptions, loadDictionaries } from "@/server/options";
import { Badge, Card, FilterField, PageHeader, Select, StatusBadge } from "@/ui/components";
import { NeedParamsSummary, needTitle } from "@/ui/domain/need-params-summary";
import { CandidatesTable, type CandidateRow } from "./candidates-table";

export const metadata = { title: "Подбор объектов" };

const TAKE = 100;

export default async function MatchingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageActor();
  const { id } = await params;
  const sp = searchParamsToObject(await searchParams);
  const filters = { strict: sp.strict, hideOffered: sp.hideOffered, sourceType: sp.sourceType, q: sp.q, take: String(TAKE) };
  let card;
  let result;
  let filterError = false;
  try {
    card = await getNeedCard(actor, id);
    try {
      result = await findCandidates(actor, id, filters);
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      filterError = true;
      result = await findCandidates(actor, id, { take: String(TAKE) });
    }
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { need, clientVisible } = card;
  const dicts = await loadDictionaries();
  const base = `/needs/${id}`;
  const isOpen = need.status === "active" || need.status === "paused";

  const rows: CandidateRow[] = result.items.map((p) => {
    const extra: string[] = [];
    if (p.roomsCount !== null) extra.push(`${p.roomsCount} комн.`);
    if (p.floor !== null) extra.push(`${p.floor} эт.`);
    if (p.commercialPurpose) extra.push(dictLabel(dicts, "commercial_purpose", p.commercialPurpose));
    if (p.powerKw !== null) extra.push(fmtNum(p.powerKw, "кВт"));
    if (p.parkingAvailable !== null) extra.push(p.parkingAvailable ? "парковка" : "без парковки");
    if (p.hasTenant !== null) extra.push(p.hasTenant ? "с арендатором" : "без арендатора");
    if (p.landArea !== null) extra.push(`участок ${fmtNum(p.landArea, "сот.")}`);
    if (p.buildingArea !== null) extra.push(`дом ${fmtNum(p.buildingArea, "м²")}`);
    return {
      id: p.id,
      address: p.addressText,
      district: p.district,
      typeText: [dictLabel(dicts, "property_type", p.propertyType), p.propertySubtype ? dictLabel(dicts, "property_subtype", p.propertySubtype) : null].filter(Boolean).join(" · "),
      operationText: dictLabel(dicts, "property_operation_type", p.operationType),
      sourceType: p.sourceType,
      sourceText: labelOf("propertySourceType", p.sourceType),
      areaText: fmtNum(p.area, "м²"),
      priceText: fmtMoney(p.price),
      pricePerSqmText: p.pricePerSqm !== null ? fmtMoney(p.pricePerSqm) : "—",
      status: p.status,
      statusText: labelOf("propertyStatus", p.status),
      extraText: extra.join(", "),
      responsible: p.responsible?.displayName ?? null,
      score: p.score,
      criteria: p.criteria.map((c) => ({ key: c.key, label: c.label, ok: c.ok })),
      previous: p.previous
        ? {
            status: p.previous.status,
            statusText: labelOf("matchStatus", p.previous.status),
            offeredAtText: fmtDate(p.previous.offeredAt),
            reasonText: p.previous.rejectionReasonCode ? dictLabel(dicts, "match_rejection_reason", p.previous.rejectionReasonCode) : null,
          }
        : null,
    };
  });

  const strict = sp.strict ?? "yes";
  const hideOffered = sp.hideOffered ?? "no";
  const offeredCount = need.matches.length;

  return (
    <div>
      <PageHeader
        back={{ href: base, label: "Карточка потребности" }}
        title={`Подбор: ${needTitle(dicts, need)}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {clientVisible ? (
              <Link className="link" href={`/clients/${need.client.id}`}>
                {need.client.displayName}
              </Link>
            ) : (
              <span>Клиент другого сотрудника</span>
            )}
            <StatusBadge status={need.status} label={labelOf("needStatus", need.status)} />
            <Badge tone="blue">{labelOf("needStage", need.stage)}</Badge>
            <span>· уже предложено объектов: {offeredCount}</span>
          </span>
        }
        actions={
          <Link className="btn" href={`${base}?tab=matches`}>
            Предложенные объекты
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_1fr]">
        <aside className="space-y-3 xl:sticky xl:top-16 xl:self-start">
          <Card
            title="Параметры потребности"
            actions={
              <Link className="btn btn-sm btn-link" href={`${base}/edit`}>
                Изменить
              </Link>
            }
          >
            <NeedParamsSummary need={need} dicts={dicts} />
          </Card>
          <Card title="Быстрые фильтры">
            <form method="get" action={`${base}/matching`} className="space-y-3">
              <FilterField label="Поиск: адрес или район">
                <input name="q" defaultValue={sp.q ?? ""} className="input" />
              </FilterField>
              <FilterField label="Соответствие бюджету и площади">
                <Select
                  name="strict"
                  value={strict}
                  options={[
                    { value: "yes", label: "Строго по параметрам" },
                    { value: "no", label: "Все объекты нужного типа" },
                  ]}
                />
              </FilterField>
              <FilterField label="Уже предлагавшиеся">
                <Select
                  name="hideOffered"
                  value={hideOffered}
                  options={[
                    { value: "no", label: "Показывать с отметкой" },
                    { value: "yes", label: "Скрыть" },
                  ]}
                />
              </FilterField>
              <FilterField label="Происхождение объекта">
                <Select name="sourceType" value={sp.sourceType} placeholder="Любое" options={codeOptions("propertySourceType")} />
              </FilterField>
              <div className="flex gap-2">
                <button type="submit" className="btn btn-primary">
                  Применить
                </button>
                <Link href={`${base}/matching`} className="btn">
                  Сбросить
                </Link>
              </div>
            </form>
          </Card>
        </aside>
        <section className="min-w-0 space-y-2">
          {filterError ? <div className="alert alert-warning">Некорректные параметры фильтра — показан подбор без фильтров.</div> : null}
          {!isOpen ? <div className="alert alert-info">Потребность {need.status === "success" ? "успешно завершена" : "закрыта"} — предлагать объекты можно после возобновления.</div> : null}
          <CandidatesTable needId={id} rows={rows} canPropose={isOpen} truncated={rows.length >= TAKE} strict={strict === "yes"} />
        </section>
      </div>
    </div>
  );
}
