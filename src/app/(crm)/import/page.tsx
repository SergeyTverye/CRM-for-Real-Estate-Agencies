import Link from "next/link";
import { requirePageActor } from "@/server/page-auth";
import { listImportJobs } from "@/modules/import/application/import-service";
import { getConfig } from "@/shared/config/env";
import { labelOf } from "@/shared/codebook";
import { fmtDateTime } from "@/server/format";
import { Badge, Card, EmptyState, PageHeader } from "@/ui/components";
import { ImportUploadForm } from "@/ui/domain/import-upload";
import { AutoRefresh } from "@/ui/domain/ops-refresh";
import { JOB_STATUS_TONES } from "./labels";

export const metadata = { title: "Импорт данных" };

const RUNNING = ["uploaded", "parsing", "committing"];

export default async function ImportJobsPage() {
  const actor = await requirePageActor({ manager: true });
  const jobs = await listImportJobs(actor);
  const cfg = getConfig();
  const running = jobs.find((j) => j.status === "parsing" || j.status === "committing");

  return (
    <div>
      <PageHeader
        title="Импорт данных"
        subtitle="Перенос исторического Excel-файла: проверка без изменения данных (dry-run), затем загрузка выбранных секций"
        actions={<AutoRefresh active={Boolean(running)} />}
      />

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Загрузить файл" className="lg:col-span-2">
          <ImportUploadForm maxMb={cfg.MAX_UPLOAD_MB} blockedReason={running ? "Сейчас выполняется другой импорт — дождитесь его завершения." : null} />
        </Card>
        <Card title="Как проходит импорт">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
            <li>Выберите файл .xlsx.</li>
            <li>Система найдёт листы и логические секции по маркерам и заголовкам.</li>
            <li>Покажет профиль импорта и сопоставление колонок.</li>
            <li>Проверит строки без изменения данных CRM (dry-run).</li>
            <li>Покажет ошибки, предупреждения и вероятные дубли.</li>
            <li>Загрузка выбранных секций — только после проверки и вашего подтверждения.</li>
          </ol>
          <p className="mt-2 text-xs text-slate-500">Паспорт, «Выдан», «Регистрация» и дата рождения исключаются политикой ещё до проверки: их значения не читаются в CRM, не попадают в результаты проверки и отчёты.</p>
        </Card>
      </div>

      <Card title="Задания импорта" bodyClassName="">
        {jobs.length === 0 ? (
          <EmptyState title="Импортов ещё не было" hint="Загрузите Excel-файл выше: сначала будет выполнена проверка, данные CRM при этом не изменятся." />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Файл</th>
                <th>Статус</th>
                <th>Загрузил</th>
                <th>Начат</th>
                <th>Завершён</th>
                <th className="text-right">Прочитано</th>
                <th className="text-right">Загружено</th>
                <th className="text-right">Пропущено</th>
                <th className="text-right">Ошибок</th>
                <th className="text-right">Вероятные дубли</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>
                    <Link href={`/import/${j.id}`} className="link font-medium">
                      {j.sourceFilename}
                    </Link>
                    <div className="font-mono text-xs text-slate-400" title={`SHA-256: ${j.sourceSha256}`}>
                      {j.sourceSha256.slice(0, 12)}…
                    </div>
                  </td>
                  <td>
                    <Badge tone={JOB_STATUS_TONES[j.status] ?? "gray"}>{labelOf("importJobStatus", j.status)}</Badge>
                    {RUNNING.includes(j.status) ? <div className="mt-0.5 text-xs text-slate-500">выполняется…</div> : null}
                  </td>
                  <td>{j.starter.displayName}</td>
                  <td>{fmtDateTime(j.startedAt)}</td>
                  <td>{j.finishedAt ? fmtDateTime(j.finishedAt) : "—"}</td>
                  <td className="text-right tabular-nums">{j.rowsRead}</td>
                  <td className="text-right tabular-nums">{j.rowsImported}</td>
                  <td className="text-right tabular-nums">{j.rowsSkipped}</td>
                  <td className={`text-right tabular-nums ${j.rowsError > 0 ? "font-medium text-red-700" : ""}`}>{j.rowsError}</td>
                  <td className="text-right tabular-nums">{j.probableDuplicates}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {jobs.length >= 100 ? <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">Показаны последние 100 заданий.</p> : null}
      </Card>
    </div>
  );
}
