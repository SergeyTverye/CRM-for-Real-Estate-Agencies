import Link from "next/link";
import { requirePageActor } from "@/server/page-auth";
import { getOperationsStatus } from "@/modules/operations/application/operations-service";
import { labelOf } from "@/shared/codebook";
import { fmtDateTime } from "@/server/format";
import { Badge, Card, Dl, EmptyState, PageHeader, type Tone } from "@/ui/components";
import { BackupNowButton, VerifyBackupButton } from "@/ui/domain/ops-backup-actions";
import { AutoRefresh, RefreshButton } from "@/ui/domain/ops-refresh";

export const metadata = { title: "Эксплуатация" };

type Status = Awaited<ReturnType<typeof getOperationsStatus>>;
type Remote = Status["remotes"][number];

const LOCAL_TONES: Record<string, Tone> = { pending: "gray", running: "blue", success: "green", failed: "red" };
const UPLOAD_TONES: Record<string, Tone> = { pending: "gray", uploading: "blue", uploaded: "green", failed: "red", skipped: "gray" };
const VERIFY_TONES: Record<string, Tone> = { not_verified: "gray", verifying: "blue", verified: "green", failed: "red" };

const STALE_HOURS = 26;

function fmtBytes(v: number | bigint | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  let x = n;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: i === 0 ? 0 : 1 }).format(x)} ${units[i]}`;
}

function hoursSince(d: Date | string | null | undefined): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? (Date.now() - t) / 3_600_000 : null;
}

function fmtHours(h: number): string {
  if (h < 1) return "менее часа";
  if (h < 48) return `${Math.round(h)} ч`;
  return `${Math.round(h / 24)} дн.`;
}

function duration(start: Date, end: Date | null): string {
  if (!end) return "";
  const s = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  return s < 60 ? `${s} с` : `${Math.floor(s / 60)} мин ${s % 60} с`;
}

function CheckLine({ ok, okText, failText }: { ok: boolean; okText: string; failText: string }) {
  return ok ? <Badge tone="green">✓ {okText}</Badge> : <Badge tone="red">✕ {failText}</Badge>;
}

function RemoteCard({ r, lastLocalAt }: { r: Remote; lastLocalAt: Date | null }) {
  const lag = r.lagFromLocal;
  const noVerified = !r.lastVerified;
  const lastFailed = r.lastRun && (r.lastRun.uploadStatus === "failed" || r.lastRun.verifyStatus === "failed");
  const problem = r.isEnabled && (noVerified || lastFailed || (lag !== null && lag > STALE_HOURS));
  const border = problem ? (r.isMandatory ? "border-l-4 border-l-red-500" : "border-l-4 border-l-amber-400") : "";
  return (
    <Card
      className={border}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {r.displayName}
          <span className="font-mono text-xs font-normal text-slate-500">{r.remoteCode}</span>
        </span>
      }
      actions={
        <span className="flex gap-1">
          <Badge tone={r.isEnabled ? "green" : "gray"}>{r.isEnabled ? "Включён" : "Выключен"}</Badge>
          <Badge tone={r.isMandatory ? "blue" : "gray"}>{r.isMandatory ? "Обязательный" : "Необязательный"}</Badge>
        </span>
      }
    >
      {problem ? <div className={`alert ${r.isMandatory ? "alert-error" : "alert-warning"} mb-2 text-xs`}>⚠ Требует внимания: {noVerified ? "нет проверенной реплики" : lastFailed ? "последняя попытка завершилась ошибкой" : "реплика отстаёт от локального backup"}</div> : null}
      <Dl
        items={[
          ["Провайдер", `${labelOf("backupProviderType", r.providerType)} · ${labelOf("backupTransportType", r.transportType)}`],
          [
            "Последняя проверенная реплика",
            r.lastVerified ? (
              <span key="lv">
                <span className="font-mono text-xs">{r.lastVerified.backupRun.backupId}</span> · проверена {fmtDateTime(r.lastVerified.verifiedAt ?? r.lastVerified.finishedAt)}
              </span>
            ) : (
              <span key="lv" className="font-medium text-red-700">нет</span>
            ),
          ],
          [
            "Отставание от локального backup",
            lag === null ? (lastLocalAt ? "нет проверенной реплики" : "нет успешного локального backup") : lag <= 0 ? "нет — реплика актуальна" : <span key="lag" className={lag > STALE_HOURS ? "font-medium text-amber-800" : ""}>{fmtHours(lag)}</span>,
          ],
          [
            "Последняя попытка",
            r.lastRun ? (
              <span key="lr" className="flex flex-wrap items-center gap-1">
                <span className="font-mono text-xs">{r.lastRun.backupRun.backupId}</span>
                <Badge tone={UPLOAD_TONES[r.lastRun.uploadStatus] ?? "gray"}>отправка: {labelOf("backupUploadStatus", r.lastRun.uploadStatus)}</Badge>
                <Badge tone={VERIFY_TONES[r.lastRun.verifyStatus] ?? "gray"}>проверка: {labelOf("backupVerifyStatus", r.lastRun.verifyStatus)}</Badge>
                {r.lastRun.attemptCount > 1 ? <span className="text-xs text-slate-500">попыток: {r.lastRun.attemptCount}</span> : null}
                {r.lastRun.finishedAt ? <span className="text-xs text-slate-500">{fmtDateTime(r.lastRun.finishedAt)}</span> : null}
              </span>
            ) : (
              "запусков не было"
            ),
          ],
          ["Последняя ошибка", r.lastRun?.errorSummary || r.lastRun?.errorCode ? <span key="le" className="text-red-700">{[r.lastRun.errorCode, r.lastRun.errorSummary].filter(Boolean).join(": ")}</span> : "—"],
          ["Проверка доступности", r.lastProbeAt ? `${r.probeStatus ?? "—"} · ${fmtDateTime(r.lastProbeAt)}` : "не выполнялась"],
        ]}
      />
    </Card>
  );
}

export default async function OperationsPage() {
  const actor = await requirePageActor({ manager: true });
  const st = await getOperationsStatus(actor);
  const { instance, health } = st;
  const standby = instance.instanceRole === "standby";
  const running = st.runs.some((r) => r.localStatus === "running" || r.localStatus === "pending");
  const last = st.lastLocalBackup;
  const lastAge = hoursSince(last?.startedAt);
  const lastStale = !last || (lastAge !== null && lastAge > STALE_HOURS);
  const migrations = st.schema;
  const migrationsCount = /migrations=(\d+)/.exec(health.checks.database?.detail ?? "")?.[1];
  const remoteCodes = new Set(st.remotes.map((r) => r.remoteCode));
  const configuredWithoutRuns = st.configuredTargets.filter((c) => !remoteCodes.has(c));

  return (
    <div>
      <PageHeader
        title="Эксплуатация"
        subtitle="Версия и узел, состояние хранилищ, резервные копии и off-site реплики"
        actions={
          <>
            <AutoRefresh active={running} label="Идёт резервное копирование — страница обновляется каждые 4 с" />
            <RefreshButton />
          </>
        }
      />

      {standby ? (
        <div className="mb-4 rounded-md border-2 border-amber-400 bg-amber-50 px-4 py-3 text-amber-900" role="alert">
          <div className="text-base font-semibold">⚠ Узел в режиме STANDBY — только чтение</div>
          <p className="mt-1 text-sm">
            Изменение бизнес-данных на этом экземпляре заблокировано. Перевод восстановленного узла в active writer выполняется отдельной подтверждённой административной процедурой; одновременная работа старого и
            нового экземпляра недопустима.
          </p>
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Экземпляр">
          <Dl
            items={[
              ["Версия", <span key="v" className="font-mono text-xs">{instance.version} · {instance.commit.slice(0, 12)}</span>],
              ["Режим развёртывания", instance.deploymentMode === "portable" ? "Портативный (portable)" : "Серверный (server)"],
              [
                "Роль узла",
                standby ? <Badge key="r" tone="yellow">Standby — только чтение</Badge> : <Badge key="r" tone="green">Active — рабочий узел (запись)</Badge>,
              ],
              ["deployment_id", <span key="d" className="break-all font-mono text-xs">{instance.deploymentId}</span>],
              ["instance_id", <span key="i" className="break-all font-mono text-xs">{instance.instanceId}</span>],
              ["Часовой пояс", instance.timeZone],
            ]}
          />
        </Card>
        <Card title="Состояние" actions={<Badge tone={health.status === "ok" ? "green" : "red"}>{health.status === "ok" ? "✓ Готов к работе" : "✕ Есть проблемы"}</Badge>}>
          <Dl
            items={[
              ["База данных", <CheckLine key="db" ok={Boolean(health.checks.database?.ok)} okText="Доступна" failText={`Недоступна${health.checks.database?.detail ? ` (${health.checks.database.detail})` : ""}`} />],
              [
                "Файловое хранилище",
                <CheckLine key="fs" ok={Boolean(health.checks.fileStorage?.ok)} okText="Доступно для записи" failText={`Ошибка${health.checks.fileStorage?.detail ? `: ${health.checks.fileStorage.detail}` : ""}`} />,
              ],
              ["Объём файлов", `${fmtBytes(st.files.bytes)} · файлов: ${st.files.files}`],
            ]}
          />
        </Card>
        <Card title="Схема БД">
          {migrations.length ? (
            <>
              <Dl
                items={[
                  ["Версия схемы", <span key="m" className="break-all font-mono text-xs">{migrations[0]!.migration_name}</span>],
                  ["Применена", fmtDateTime(migrations[0]!.finished_at)],
                  ["Всего миграций", migrationsCount ?? "—"],
                ]}
              />
              {migrations.length > 1 ? (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-brand-600">Последние миграции</summary>
                  <ul className="mt-1 space-y-0.5 font-mono text-slate-600">
                    {migrations.map((m) => (
                      <li key={m.migration_name}>{m.migration_name}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          ) : (
            <span className="text-sm text-slate-500">Сведения о миграциях недоступны</span>
          )}
        </Card>
      </div>

      <Card
        title="Локальное резервное копирование"
        className="mb-4"
        actions={<BackupNowButton latestRunId={st.runs[0]?.id ?? null} running={running} />}
      >
        {last ? (
          <div className={lastStale ? "alert alert-warning mb-3" : "mb-3"}>
            <div className="text-sm">
              Последний успешный backup: <span className="font-mono">{last.backupId}</span> · {fmtDateTime(last.startedAt)}
              {lastAge !== null ? <span className="text-slate-500"> ({fmtHours(lastAge)} назад)</span> : null}
              {lastStale ? <span className="ml-1 font-medium">— ⚠ старше суток, создайте новую копию</span> : null}
            </div>
            <div className="text-xs text-slate-500">
              {labelOf("backupTriggerType", last.triggerType)} · БД {fmtBytes(last.databaseDumpSize)} · файлы {fmtBytes(last.filesArchiveSize)}
              {last.schemaVersion ? ` · схема ${last.schemaVersion}` : ""}
            </div>
          </div>
        ) : (
          <div className="alert alert-warning mb-3">⚠ Успешных локальных копий ещё нет. Создайте backup кнопкой справа или скриптом <code>./scripts/backup.sh</code>.</div>
        )}

        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Журнал запусков (BackupRun)</h3>
        {st.runs.length === 0 ? (
          <EmptyState title="Запусков резервного копирования ещё не было" hint="Здесь появятся ручные и плановые запуски с результатом и ошибками." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Backup ID</th>
                  <th>Начат</th>
                  <th>Запуск</th>
                  <th>Инициатор</th>
                  <th>Статус</th>
                  <th>Размер</th>
                  <th>Реплики</th>
                  <th>Ошибка</th>
                </tr>
              </thead>
              <tbody>
                {st.runs.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono text-xs">{r.backupId}</td>
                    <td className="whitespace-nowrap">
                      {fmtDateTime(r.startedAt)}
                      {r.finishedAt ? <div className="text-xs text-slate-500">длительность {duration(r.startedAt, r.finishedAt)}</div> : null}
                    </td>
                    <td>{labelOf("backupTriggerType", r.triggerType)}</td>
                    <td>{r.initiator?.displayName ?? <span className="text-slate-400">система</span>}</td>
                    <td>
                      <Badge tone={LOCAL_TONES[r.localStatus] ?? "gray"}>{labelOf("backupLocalStatus", r.localStatus)}</Badge>
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {r.databaseDumpSize !== null || r.filesArchiveSize !== null ? (
                        <>
                          БД {fmtBytes(r.databaseDumpSize)}
                          <br />
                          файлы {fmtBytes(r.filesArchiveSize)}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="text-xs">
                      {r.targetRuns.length === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {r.targetRuns.map((t) => (
                            <li key={t.id} className="flex flex-wrap items-center gap-1">
                              <span className="font-mono">{t.backupRemote.remoteCode}</span>
                              <Badge tone={UPLOAD_TONES[t.uploadStatus] ?? "gray"}>{labelOf("backupUploadStatus", t.uploadStatus)}</Badge>
                              <Badge tone={VERIFY_TONES[t.verifyStatus] ?? "gray"}>{labelOf("backupVerifyStatus", t.verifyStatus)}</Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="max-w-xs text-xs">{r.errorSummary ? <span className="text-red-700">{r.errorSummary}</span> : <span className="text-slate-400">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Копии на диске сервера" className="mb-4" bodyClassName="">
        {st.localBackups.length === 0 ? (
          <EmptyState title="Локальных копий на диске нет" hint="Каталог резервных копий пуст или недоступен. После успешного backup копия появится здесь, и её можно будет проверить." />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Backup ID</th>
                <th>Создан</th>
                <th>Запуск</th>
                <th>Схема</th>
                <th className="text-right">Размер</th>
                <th>Проверка копии</th>
              </tr>
            </thead>
            <tbody>
              {st.localBackups.map((b) => (
                <tr key={b.backupId}>
                  <td className="font-mono text-xs">{b.backupId}</td>
                  <td>{b.createdAt ? fmtDateTime(b.createdAt) : <span className="text-red-700">manifest не прочитан</span>}</td>
                  <td>{b.triggerType ? labelOf("backupTriggerType", b.triggerType) : "—"}</td>
                  <td className="max-w-48 break-all font-mono text-xs">{b.schemaVersion ?? "—"}</td>
                  <td className="text-right tabular-nums">{fmtBytes(b.sizeBytes)}</td>
                  <td>
                    <VerifyBackupButton backupId={b.backupId} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">Проверка сверяет контрольные суммы и manifest, читает dump БД и архив файлов. Данные рабочей среды при этом не изменяются.</p>
      </Card>

      <h2 className="mb-2 text-base font-semibold text-slate-800">Off-site реплики (облака и внешние диски)</h2>
      {st.remotes.length === 0 ? (
        <Card className="mb-4">
          <div className="space-y-2 text-sm text-slate-700">
            <p className="font-medium">Off-site хранилища не настроены{st.configuredTargets.length ? " или ещё не получали реплик" : ""}.</p>
            <p>
              Цели резервного копирования настраивает администратор сервера: список задаётся в <code>.env</code> переменной <code>BACKUP_TARGETS</code> (например, <code>yandex-main,mailru-secondary</code>), ключи
              доступа и пароли шифрования хранятся во внешней конфигурации и в CRM не попадают. Репликация выполняется скриптами: <code>./scripts/backup.sh --targets all</code>, повтор ошибочных —{" "}
              <code>./scripts/backup-retry.sh &lt;backup_id&gt;</code>.
            </p>
            <p className="text-xs text-slate-500">Отсутствие off-site копий не блокирует работу, если локальное восстановление проверено (ТЗ 39.1); при включении хотя бы один remote должен пройти тестовое восстановление.</p>
            {st.configuredTargets.length ? <p className="text-xs">Цели в конфигурации: {st.configuredTargets.map((c) => <code key={c} className="mr-1">{c}</code>)}</p> : null}
          </div>
        </Card>
      ) : (
        <>
          <div className="mb-2 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {st.remotes.map((r) => (
              <RemoteCard key={r.id} r={r} lastLocalAt={last?.startedAt ?? null} />
            ))}
          </div>
          <p className="mb-4 text-xs text-slate-500">
            Отправка во все облака и повтор ошибочных реплик выполняются скриптами <code>./scripts/backup.sh --targets all</code> и <code>./scripts/backup-retry.sh &lt;backup_id&gt;</code>; проверка реплик —{" "}
            <code>./scripts/backup-verify.sh &lt;backup_id&gt; --targets all</code>.
            {configuredWithoutRuns.length ? <> Цели из конфигурации без запусков репликации: {configuredWithoutRuns.join(", ")}.</> : null}
          </p>
        </>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Тестовое восстановление (T08)" bodyClassName="">
          {st.restoreReports.length === 0 ? (
            <EmptyState title="Отчётов тестового восстановления нет" hint="Запустите ./scripts/restore-test.sh на сервере: копия восстанавливается в отдельный контур и проверяется (вход, счётчики записей, контрольный файл)." />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Отчёт</th>
                  <th>Дата</th>
                  <th>Результат</th>
                </tr>
              </thead>
              <tbody>
                {st.restoreReports.map((r) => (
                  <tr key={r.name}>
                    <td className="font-mono text-xs">{r.name}</td>
                    <td>{r.at ? fmtDateTime(r.at) : "—"}</td>
                    <td>{r.passed ? <Badge tone="green">✓ Успешно</Badge> : <Badge tone="red">✕ Есть ошибки</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Восстановление рабочей среды">
          <div className="space-y-2 text-sm text-slate-700">
            <p>
              Восстановление рабочей среды из интерфейса <b>не выполняется</b>. Оно запускается на сервере скриптом <code>./scripts/restore.sh &lt;backup_id&gt;</code>, который проверяет manifest и контрольные суммы,
              запрашивает явное подтверждение и перед заменой данных делает защитный снимок текущего состояния.
            </p>
            <p className="text-xs text-slate-500">
              Перед восстановлением проверьте копию кнопкой «Проверить копию» и тестовым восстановлением (<code>./scripts/restore-test.sh</code>). Выгрузка{" "}
              <Link href="/reports" className="link">
                данных в ZIP/CSV
              </Link>{" "}
              не заменяет резервное копирование.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
