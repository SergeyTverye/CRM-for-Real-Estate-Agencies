import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageActor } from "@/server/page-auth";
import { getImportJob } from "@/modules/import/application/import-service";
import { loadProfiles } from "@/modules/import/domain/profiles";
import { dictLabel } from "@/modules/dictionaries/application/dictionaries-service";
import { NotFoundError } from "@/shared/errors";
import { labelOf, optionsOf } from "@/shared/codebook";
import { searchParamsToObject } from "@/shared/validation";
import { fmtDateOnly, fmtDateTime } from "@/server/format";
import { loadDictionaries, userOptions, type Dictionaries } from "@/server/options";
import { Badge, Card, Dl, EmptyState, FilterBar, FilterField, PageHeader, Pagination, Select } from "@/ui/components";
import { ActionButton } from "@/ui/client-kit";
import { ImportCommitPanel, type CommitSectionInfo } from "@/ui/domain/import-commit-panel";
import { AutoRefresh } from "@/ui/domain/ops-refresh";
import {
  COMMIT_TONES,
  JOB_STATUS_TONES,
  MAPPING_FIELD_LABELS,
  PREVIEW_FIELD_LABELS,
  PREVIEW_PRIMARY,
  TARGET_LABELS,
  VALIDATION_STATUS_ORDER,
  VALIDATION_TONES,
  rowCodeLabel,
} from "../labels";

export const metadata = { title: "Задание импорта" };

type JobView = Awaited<ReturnType<typeof getImportJob>>;
type Section = JobView["sections"][number];
type Row = JobView["rows"][number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALIDATION_SET = new Set<string>(VALIDATION_STATUS_ORDER);
const COMMIT_SET = new Set(["imported", "skipped", "error"]);
const CANCELLABLE = ["uploaded", "dry_run_ready", "dry_run_failed"];
const PAGE_SIZE = 25;
/** Предупреждения, которые носят справочный характер (не требуют действий). */
const INFO_CODES = new Set(["policy_fields_excluded", "phone_removed_from_description"]);

const sourceSectionOf = (s: Section) => s.profileCode ?? `unrecognized:${s.sectionKey}`;
const sectionTitle = (s: Section) => s.title ?? `Не распознана: «${s.markerText}»`;
const sectionLocation = (s: Section) => `${s.sheetName}, строки ${s.rowRange[0]}–${s.rowRange[1]}`;

function qs(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Безопасное отображение нормализованного значения preview (исключённые политикой колонки сервер не читает). */
function previewValue(dicts: Dictionaries, target: string | null, key: string, v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return fmtDateOnly(v);
  if (typeof v === "boolean") return v ? "да" : "нет";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/.test(v)) return fmtDateOnly(new Date(v));
    if (key === "operationType") return dictLabel(dicts, target === "client_request_need" ? "need_operation_type" : "property_operation_type", v);
    if (key === "propertyType" && target !== "historical_deal_archive") return dictLabel(dicts, "property_type", v);
    if (key === "needStatus") return labelOf("needStatus", v);
    if (key === "coordinatesKind") return labelOf("contactType", v);
    if (key === "sourceType") return labelOf("propertySourceType", v);
    return v.length > 140 ? `${v.slice(0, 137)}…` : v;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("name" in o || "phone" in o) return [o.name, o.phone].filter(Boolean).join(", ");
  }
  return null;
}

function Preview({ row, dicts }: { row: Row; dicts: Dictionaries }) {
  const rec = row.preview;
  if (!rec || Object.keys(rec).length === 0) return <span className="text-xs text-slate-400">{rec ? "нет значений" : "недоступно"}</span>;
  const target = row.targetEntityType && PREVIEW_PRIMARY[row.targetEntityType] ? row.targetEntityType : null;
  const entries = Object.entries(rec)
    .map(([k, v]) => [k, previewValue(dicts, target, k, v)] as const)
    .filter((e): e is readonly [string, string] => e[1] !== null);
  if (entries.length === 0) return <span className="text-xs text-slate-400">нет значений</span>;
  const primaryKeys = target ? PREVIEW_PRIMARY[target]! : entries.slice(0, 3).map(([k]) => k);
  const primary = entries.filter(([k]) => primaryKeys.includes(k));
  return (
    <div className="max-w-md text-xs">
      <div className="text-slate-700">
        {(primary.length ? primary : entries.slice(0, 3)).map(([k, v]) => (
          <span key={k} className="mr-2 inline-block">
            <span className="text-slate-400">{PREVIEW_FIELD_LABELS[k] ?? k}:</span> {v}
          </span>
        ))}
      </div>
      {entries.length > primary.length ? (
        <details className="mt-0.5">
          <summary className="cursor-pointer text-brand-600">все значения ({entries.length})</summary>
          <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-2 gap-y-0.5">
            {entries.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-slate-400">{PREVIEW_FIELD_LABELS[k] ?? k}</dt>
                <dd className="break-words text-slate-700">{v}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  );
}

function entityHref(type: string | null, id: string | null): string | null {
  if (!type || !id) return null;
  if (type === "Client") return `/clients/${id}`;
  if (type === "Property") return `/properties/${id}`;
  if (type === "HistoricalDealArchive") return `/archive/${id}`;
  return null;
}

function Steps({ status, sections }: { status: string; sections: Section[] }) {
  const recognized = sections.some((s) => s.status === "recognized");
  const checked = !["uploaded", "parsing"].includes(status);
  const done = ["completed", "completed_with_errors"].includes(status);
  const steps: { href: string; label: string; state: "done" | "current" | "todo" | "failed" }[] = [
    { href: "#file", label: "Файл", state: "done" },
    { href: "#sections", label: "Листы и секции", state: sections.length ? "done" : checked ? "failed" : "todo" },
    { href: "#mapping", label: "Профиль и mapping", state: recognized ? "done" : checked ? "failed" : "todo" },
    { href: "#checks", label: "Проверка (dry-run)", state: status === "dry_run_failed" ? "failed" : checked ? "done" : "current" },
    { href: "#rows", label: "Ошибки и дубли", state: checked && status !== "dry_run_failed" ? "done" : "todo" },
    { href: "#commit", label: "Загрузка", state: done ? "done" : ["dry_run_ready", "committing"].includes(status) ? "current" : "todo" },
  ];
  const cls = { done: "border-green-200 bg-green-50 text-green-800", current: "border-brand-500 bg-brand-50 text-brand-700", todo: "border-slate-200 bg-white text-slate-500", failed: "border-red-200 bg-red-50 text-red-800" };
  const mark = { done: "✓", current: "→", todo: "", failed: "✕" };
  const sr = { done: "выполнено", current: "текущий шаг", todo: "ещё не выполнено", failed: "не удалось" };
  return (
    <ol className="mb-4 flex flex-wrap gap-2" aria-label="Шаги мастера импорта">
      {steps.map((s, i) => (
        <li key={s.href}>
          <a href={s.href} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium hover:underline ${cls[s.state]}`} aria-current={s.state === "current" ? "step" : undefined}>
            <span className="tabular-nums">{i + 1}.</span> {s.label} {mark[s.state] ? <span aria-hidden>{mark[s.state]}</span> : null}
            <span className="sr-only">({sr[s.state]})</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

function SectionMapping({ s, profile }: { s: Section; profile?: { version: string; target: string } }) {
  if (s.status !== "recognized") {
    return (
      <Card
        title={
          <span className="flex flex-wrap items-center gap-2">
            {sectionTitle(s)}
            <Badge tone="gray">Не распознана</Badge>
          </span>
        }
        actions={<span className="text-xs text-slate-500">{sectionLocation(s)}</span>}
      >
        <div className="alert alert-warning mb-3 text-sm">
          Маркер найден, но заголовки не совпали с профилем{s.candidateProfiles.length ? ` (ближайший: ${s.candidateProfiles.join(", ")})` : ""}. Секция требует настройки mapping и автоматически не импортируется. После подтверждения
          сопоставления оно фиксируется новой версией профиля в import-profiles/.
        </div>
        {s.unknownFields.length ? (
          <div className="text-sm">
            <div className="label">Заголовки секции, не сопоставленные с профилем</div>
            <ul className="flex flex-wrap gap-1.5">
              {s.unknownFields.map((h) => (
                <li key={h} className="badge badge-gray">
                  {h}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
    );
  }
  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {sectionTitle(s)}
          <span className="font-mono text-xs font-normal text-slate-500">
            {s.profileCode}
            {profile ? ` · v${profile.version}` : ""}
          </span>
          {s.committed ? <Badge tone="green">Загружена</Badge> : null}
        </span>
      }
      actions={<span className="text-xs text-slate-500">{sectionLocation(s)}</span>}
    >
      <div className="space-y-3">
        {profile ? (
          <div className="text-xs text-slate-500">
            Куда загружается: <span className="text-slate-700">{TARGET_LABELS[profile.target] ?? profile.target}</span>
          </div>
        ) : null}
        {s.excludedByPolicy.length ? (
          <div className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">Исключено политикой минимизации ПДн</div>
            <ul className="space-y-0.5 text-sm">
              {s.excludedByPolicy.map((h) => (
                <li key={h}>
                  <span className="font-medium text-slate-800 line-through decoration-slate-500">{h}</span> — исключено политикой, значения не загружаются
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-slate-500">Значения этих колонок не читаются при проверке, не сохраняются в CRM, результатах проверки, логах и не показываются в предпросмотре.</p>
          </div>
        ) : null}
        {s.unresolvedFields.length ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-900">Неоднозначные поля</div>
            <ul className="space-y-0.5 text-sm text-amber-900">
              {s.unresolvedFields.map((h) => (
                <li key={h}>
                  <span className="font-medium">«{h}»</span> — смысл не установлен: требует подтверждения, не импортируется
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {s.unknownFields.length ? (
          <div className="rounded-md border border-slate-200 px-3 py-2">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">Колонки вне профиля</div>
            <ul className="space-y-0.5 text-sm text-slate-700">
              {s.unknownFields.map((h) => (
                <li key={h}>
                  <span className="font-medium">«{h}»</span> — не сопоставлена с полем CRM, не импортируется
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <details>
          <summary className="cursor-pointer text-sm text-brand-600">Сопоставление колонок: {s.mapping.length}</summary>
          <table className="table mt-2">
            <thead>
              <tr>
                <th>Колонка в файле</th>
                <th>Поле CRM</th>
                <th>Код поля</th>
              </tr>
            </thead>
            <tbody>
              {s.mapping.map((m) => (
                <tr key={`${m.header}-${m.field}`}>
                  <td>{m.header}</td>
                  <td>{MAPPING_FIELD_LABELS[m.field] ?? m.field}</td>
                  <td className="font-mono text-xs text-slate-500">{m.field}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </Card>
  );
}

export default async function ImportJobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePageActor({ manager: true });
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const sp = searchParamsToObject(await searchParams);

  // Фильтры строк нормализуются здесь, чтобы некорректный параметр не скрывал карточку задания.
  const show = sp.show === "all" ? "all" : "problems";
  const filters = {
    show,
    section: sp.section && sp.section.length <= 100 ? sp.section : undefined,
    validationStatus: sp.validationStatus && VALIDATION_SET.has(sp.validationStatus) ? sp.validationStatus : undefined,
    commitResult: sp.commitResult && COMMIT_SET.has(sp.commitResult) ? sp.commitResult : undefined,
  };
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  let data: JobView;
  try {
    data = await getImportJob(actor, id, {
      section: filters.section,
      validationStatus: filters.validationStatus,
      commitResult: filters.commitResult,
      problemsOnly: show === "problems" ? "yes" : undefined,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { job, sections, rows, total } = data;
  const [dicts, users] = await Promise.all([loadDictionaries(), userOptions()]);
  const profiles = new Map(loadProfiles().map((p) => [p.code, { version: p.version, target: p.target }]));
  const bySource = new Map(sections.map((s) => [sourceSectionOf(s), s]));
  const base = `/import/${id}`;
  const running = job.status === "parsing" || job.status === "committing";
  const anyCommitted = sections.some((s) => s.committed);
  const filterParams = Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as Record<string, string>;
  const rowsHref = (extra: Record<string, string | undefined>) => `${base}${qs({ show: "all", ...extra })}#rows`;

  const totals = VALIDATION_STATUS_ORDER.reduce<Record<string, number>>((acc, st) => ({ ...acc, [st]: sections.reduce((s, x) => s + (x.counts[st] ?? 0), 0) }), {});
  const totalRows = sections.reduce((s, x) => s + (x.counts.total ?? 0), 0);
  const totalDup = sections.reduce((s, x) => s + (x.counts.probable_duplicate ?? 0), 0);

  const commitSections: CommitSectionInfo[] = sections.map((s) => ({
    key: s.sectionKey,
    title: sectionTitle(s),
    profileCode: s.profileCode,
    location: sectionLocation(s),
    recognized: s.status === "recognized",
    committed: s.committed,
    total: s.counts.total ?? 0,
    candidates: (s.counts.ready ?? 0) + (s.counts.warning ?? 0),
    skipped: (s.counts.invalid ?? 0) + (s.counts.unrecognized ?? 0) + (s.counts.skipped_policy ?? 0),
    duplicates: s.counts.probable_duplicate ?? 0,
  }));

  const sectionOptions = sections.map((s) => ({ value: sourceSectionOf(s), label: `${sectionTitle(s)} (${sectionLocation(s)})` }));
  const commitDone = job.rowsRead > 0;

  return (
    <div>
      <PageHeader
        back={{ href: "/import", label: "Импорт данных" }}
        title={`Импорт: ${job.sourceFilename}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={JOB_STATUS_TONES[job.status] ?? "gray"}>{labelOf("importJobStatus", job.status)}</Badge>
            <span>загрузил {job.starter.displayName}, {fmtDateTime(job.startedAt)}</span>
          </span>
        }
        actions={
          <>
            <AutoRefresh active={running} />
            {CANCELLABLE.includes(job.status) ? (
              <ActionButton
                url={`/api/v1/import/jobs/${id}/cancel`}
                label="Отменить задание"
                className="btn btn-danger"
                pendingLabel="Отмена…"
                confirm={
                  anyCommitted
                    ? "Отменить задание? Незагруженные секции не будут загружены, уже загруженные данные останутся в CRM."
                    : "Отменить задание? Данные CRM не изменялись; исходный файл будет удалён из временного хранилища."
                }
              />
            ) : null}
          </>
        }
      />

      <Steps status={job.status} sections={sections} />

      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card title="1. Файл">
          <div id="file" className="scroll-mt-20" />
          <Dl
            items={[
              ["Имя файла", job.sourceFilename],
              [
                "SHA-256",
                <span key="sha" className="font-mono text-xs" title={job.sourceSha256}>
                  {job.sourceSha256.slice(0, 16)}…
                </span>,
              ],
              ["Статус", <Badge key="st" tone={JOB_STATUS_TONES[job.status] ?? "gray"}>{labelOf("importJobStatus", job.status)}</Badge>],
              ["Начат", fmtDateTime(job.startedAt)],
              ["Завершён", job.finishedAt ? fmtDateTime(job.finishedAt) : "—"],
              ["Вероятные дубли", String(job.probableDuplicates)],
              [
                "Итог загрузки",
                commitDone ? (
                  <span key="tot" className="tabular-nums">
                    прочитано {job.rowsRead} = загружено {job.rowsImported} + пропущено {job.rowsSkipped} + ошибок {job.rowsError}
                    {job.rowsRead === job.rowsImported + job.rowsSkipped + job.rowsError ? " ✓" : " ⚠ равенство не выполнено"}
                  </span>
                ) : (
                  "загрузки ещё не было"
                ),
              ],
              ["Версии профилей", <span key="mv" className="break-all text-xs text-slate-500">{job.mappingVersion}</span>],
            ]}
          />
        </Card>

        <Card title="2. Листы и логические секции" bodyClassName="">
          <div id="sections" className="scroll-mt-20" />
          {sections.length === 0 ? (
            <EmptyState title="Секции не найдены" hint="В файле не найдено ни одного маркера раздела с ожидаемыми заголовками. Проверьте, что это исходный рабочий файл предприятия." />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Лист</th>
                      <th>Секция (маркер)</th>
                      <th>Строки</th>
                      <th>Статус</th>
                      <th className="text-right">Записей</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sections.map((s) => (
                      <tr key={s.sectionKey}>
                        <td>{s.sheetName}</td>
                        <td>
                          <div className="font-medium">{sectionTitle(s)}</div>
                          <div className="text-xs text-slate-500">
                            маркер «{s.markerText}» — строка {s.markerRow}
                            {s.headerRow ? `, заголовки — строка ${s.headerRow}` : ""}
                          </div>
                        </td>
                        <td className="whitespace-nowrap tabular-nums">
                          {s.rowRange[0]}–{s.rowRange[1]}
                        </td>
                        <td>
                          {s.status === "recognized" ? <Badge tone="green">Распознана</Badge> : <Badge tone="gray">Не распознана — нужен mapping</Badge>}
                          {s.committed ? (
                            <div className="mt-0.5">
                              <Badge tone="blue">Загружена</Badge>
                            </div>
                          ) : null}
                        </td>
                        <td className="text-right tabular-nums">{s.counts.total ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
                Листы с данными: {[...new Set(sections.map((s) => s.sheetName))].join(", ")}. Секции определяются по маркеру и набору заголовков, а не по номерам строк; пустые листы и строки вне секций не импортируются.
              </p>
            </>
          )}
        </Card>
      </div>

      <h2 id="mapping" className="mb-2 scroll-mt-20 text-base font-semibold text-slate-800">
        3. Профили импорта и сопоставление колонок
      </h2>
      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {sections.map((s) => (
          <SectionMapping key={s.sectionKey} s={s} profile={s.profileCode ? profiles.get(s.profileCode) : undefined} />
        ))}
        {sections.length === 0 ? <div className="text-sm text-slate-500">Нет секций для сопоставления.</div> : null}
      </div>

      <Card title="4. Результат проверки (dry-run)" className="mb-4" bodyClassName="">
        <div id="checks" className="scroll-mt-20" />
        <p className="px-4 pt-3 text-xs text-slate-500">
          Проверка не изменяет данные CRM. «Вероятный дубль» — дополнительная отметка и не заменяет основной статус строки. Число открывает список строк с этим статусом.
        </p>
        <table className="table mt-2">
          <thead>
            <tr>
              <th>Секция</th>
              <th className="text-right">Всего</th>
              {VALIDATION_STATUS_ORDER.map((st) => (
                <th key={st} className="text-right">
                  {labelOf("importValidationStatus", st)}
                </th>
              ))}
              <th className="text-right">Вероятные дубли</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((s) => {
              const section = sourceSectionOf(s);
              return (
                <tr key={s.sectionKey}>
                  <td>
                    <div>{sectionTitle(s)}</div>
                    <div className="text-xs text-slate-500">{sectionLocation(s)}</div>
                  </td>
                  <td className="text-right tabular-nums">
                    <Link className="link" href={rowsHref({ section })}>
                      {s.counts.total ?? 0}
                    </Link>
                  </td>
                  {VALIDATION_STATUS_ORDER.map((st) => {
                    const n = s.counts[st] ?? 0;
                    return (
                      <td key={st} className={`text-right tabular-nums ${n && st === "invalid" ? "font-medium text-red-700" : n && st === "warning" ? "text-amber-800" : ""}`}>
                        {n ? (
                          <Link className="hover:underline" href={rowsHref({ section, validationStatus: st })}>
                            {n}
                          </Link>
                        ) : (
                          <span className="text-slate-300">0</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="text-right tabular-nums">{s.counts.probable_duplicate ? <span className="font-medium text-amber-800">{s.counts.probable_duplicate}</span> : <span className="text-slate-300">0</span>}</td>
                </tr>
              );
            })}
            <tr>
              <td className="font-medium text-slate-600">Итого</td>
              <td className="text-right font-semibold tabular-nums">{totalRows}</td>
              {VALIDATION_STATUS_ORDER.map((st) => (
                <td key={st} className="text-right font-semibold tabular-nums">
                  {totals[st] ? (
                    <Link className="hover:underline" href={rowsHref({ validationStatus: st })}>
                      {totals[st]}
                    </Link>
                  ) : (
                    0
                  )}
                </td>
              ))}
              <td className="text-right font-semibold tabular-nums">{totalDup}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      <Card title="5. Проблемные строки: ошибки, предупреждения, дубли" className="mb-4" bodyClassName="">
        <div id="rows" className="scroll-mt-20" />
        <div className="px-4 pt-3">
          <FilterBar action={base} resetHref={`${base}#rows`}>
            <FilterField label="Показать">
              <Select
                name="show"
                value={show}
                options={[
                  { value: "problems", label: "Только проблемные строки" },
                  { value: "all", label: "Все строки" },
                ]}
              />
            </FilterField>
            <FilterField label="Секция">
              <Select name="section" value={filters.section} placeholder="Все секции" options={sectionOptions} className="max-w-80" />
            </FilterField>
            <FilterField label="Статус проверки">
              <Select name="validationStatus" value={filters.validationStatus} placeholder="Любой" options={optionsOf("importValidationStatus")} />
            </FilterField>
            <FilterField label="Результат загрузки">
              <Select name="commitResult" value={filters.commitResult} placeholder="Любой" options={optionsOf("importCommitResult")} />
            </FilterField>
          </FilterBar>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title={show === "problems" && !filters.validationStatus && !filters.commitResult && !filters.section ? "Проблемных строк нет" : "Строк по фильтру нет"}
            hint="Проблемными считаются строки с предупреждением, ошибкой, исключённые политикой, нераспознанные и с ошибкой загрузки."
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Лист</th>
                <th className="text-right">Строка</th>
                <th>Секция</th>
                <th>Проверка</th>
                <th>Загрузка</th>
                <th>Ошибки и предупреждения</th>
                <th>Безопасные значения</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = r.sourceSection ? bySource.get(r.sourceSection) : undefined;
                const href = entityHref(r.targetEntityType, r.targetEntityId);
                return (
                  <tr key={r.id}>
                    <td>{r.sheetName ?? "—"}</td>
                    <td className="text-right tabular-nums">{r.sourceRowNumber ?? "—"}</td>
                    <td className="max-w-48 text-xs">{s ? sectionTitle(s) : (r.sourceSection ?? "—")}</td>
                    <td>
                      <Badge tone={VALIDATION_TONES[r.validationStatus] ?? "gray"}>{labelOf("importValidationStatus", r.validationStatus)}</Badge>
                    </td>
                    <td>
                      {r.commitResult ? <Badge tone={COMMIT_TONES[r.commitResult] ?? "gray"}>{labelOf("importCommitResult", r.commitResult)}</Badge> : <span className="text-xs text-slate-400">не загружалась</span>}
                      {href ? (
                        <div className="mt-0.5">
                          <Link href={href} className="link text-xs">
                            открыть запись
                          </Link>
                        </div>
                      ) : null}
                    </td>
                    <td className="text-xs">
                      <ul className="space-y-0.5">
                        {r.errorCodes.map((c) => (
                          <li key={`e-${c}`} className="font-medium text-red-700">
                            Ошибка: {rowCodeLabel(c)}
                          </li>
                        ))}
                        {r.warningCodes.map((c) => (
                          <li key={`w-${c}`} className={INFO_CODES.has(c) ? "text-slate-500" : "text-amber-800"}>
                            {c === "probable_duplicate" ? <Badge tone="yellow">Вероятный дубль</Badge> : INFO_CODES.has(c) ? `ⓘ ${rowCodeLabel(c)}` : `⚠ ${rowCodeLabel(c)}`}
                          </li>
                        ))}
                        {r.errorCodes.length + r.warningCodes.length === 0 ? <li className="text-slate-400">—</li> : null}
                      </ul>
                    </td>
                    <td>
                      <Preview row={r} dicts={dicts} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <Pagination page={data.page} pageSize={data.pageSize} total={total} basePath={base} params={filterParams} />
      </Card>

      <Card title="6. Загрузка в CRM (commit)" className="mb-4">
        <div id="commit" className="scroll-mt-20" />
        <ImportCommitPanel jobId={id} jobStatus={job.status} sections={commitSections} users={users} />
      </Card>
    </div>
  );
}
