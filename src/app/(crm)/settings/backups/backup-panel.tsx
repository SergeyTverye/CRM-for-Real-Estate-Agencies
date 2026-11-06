"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiCall } from "@/ui/api-client";
import { useApiAction, useUnsavedChangesWarning } from "@/ui/hooks";
import { Modal } from "@/ui/client-kit";
import { FormErrorBanner } from "@/ui/form";
import type { BackupSettingsService } from "@/modules/desktop-backup/application/settings-service";
import type { backupControlStatus } from "@/modules/desktop-backup/application/backup-control";
import type { DestinationConfig } from "@/modules/desktop-backup/domain/settings";
import type { ArchiveRef } from "@/modules/desktop-backup/domain/contracts";

type Settings = Awaited<ReturnType<BackupSettingsService["get"]>>;
type Status = Awaited<ReturnType<typeof backupControlStatus>>;
type Kind = DestinationConfig["kind"];
const names: Record<Kind, string> = { yandex_s3: "Яндекс Облако", mailru_webdav: "Облако Mail.ru", removable: "USB/HDD", local: "Локально" };
const base = "/api/v1/settings/backups";
const stateNames: Record<string, string> = { queued: "В очереди", uploading: "Загрузка", uploaded: "Загружен; проверяется", verified: "Проверен", failed: "Ошибка", running: "Выполняется", success: "Локальная копия готова", restored: "Восстановлен", conflict: "Конфликт версий", incoming: "Доступно новое состояние", same: "Состояния совпадают" };
function bytes(n: number | null) { return n === null ? "Неизвестно" : `${(n / 1024 ** 3).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ГБ`; }
function date(s?: string | null) { return s ? new Date(s).toLocaleString("ru-RU") : "Ещё нет"; }
function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function recoveryKey() {
  const raw = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return `CRM1-${raw}-${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("").slice(0, 12)}`;
}
function newDestination(kind: Kind): DestinationConfig {
  const common = { id: crypto.randomUUID(), enabled: false };
  if (kind === "yandex_s3") return { ...common, kind, bucket: "", prefix: "crm", endpoint: "https://storage.yandexcloud.net", region: "ru-central1" };
  if (kind === "mailru_webdav") return { ...common, kind, email: "", prefix: "crm", endpoint: "https://webdav.cloud.mail.ru", partBytes: 64 * 1024 ** 2, useMove: false };
  return { ...common, kind, directory: "" };
}
export function BackupPanel() {
  const [settings, setSettings] = useState<Settings | null>(null), [status, setStatus] = useState<Status | null>(null);
  const savedSettings = useRef<Settings | null>(null);
  const [dirty, setDirty] = useState(false), [notice, setNotice] = useState("");
  const [destination, setDestination] = useState<DestinationConfig | null>(null);
  const [password, setPassword] = useState(""), [accessKeyId, setAccessKeyId] = useState("");
  const [dialog, setDialog] = useState<"schedule" | "create" | "give" | "restore" | "restore-from-file" | "verify" | "compare" | "receive" | "list" | null>(null);
  const [importRequestId, setImportRequestId] = useState("");
  const [nativePending, setNativePending] = useState(false);
  const [sourceId, setSourceId] = useState<string | undefined>(), [selected, setSelected] = useState("");
  const [catalog, setCatalog] = useState<ArchiveRef[]>([]);
  const [phrase, setPhrase] = useState(""), [key, setKey] = useState(""), [saved, setSaved] = useState(false), [confirmed, setConfirmed] = useState(false);
  const action = useApiAction();
  useUnsavedChangesWarning(dirty);
  const refresh = useCallback(async () => {
    const [s, t] = await Promise.all([apiCall<Settings>("GET", base), apiCall<Status>("GET", base + "/control")]);
    savedSettings.current = s; setSettings(s); setStatus(t);
  }, []);
  const run = action.run;
  useEffect(() => { void run(refresh); }, [refresh, run]);
  useEffect(() => {
    if (!settings || dirty || dialog || destination) return;
    const timer = setInterval(() => { void apiCall<Status>("GET", base + "/control").then(setStatus).catch(() => undefined); }, 10000);
    return () => clearInterval(timer);
  }, [settings, dirty, dialog, destination]);
  async function save(destinations = settings!.destinations) {
    if (!settings) return;
    const updated = await action.run(() => apiCall<Settings>("PUT", base, { expectedUpdatedAt: settings.updatedAt, destinations: destinations.map(d => { const { credentialsConfigured: _flag, ...rest } = d as typeof d & { credentialsConfigured?: boolean }; void _flag; return rest; }), schedule: settings.schedule, retention: settings.retention }));
    if (updated) { savedSettings.current = updated; setSettings(updated); setDirty(false); setDestination(null); setPassword(""); setAccessKeyId(""); setDialog(null); setNotice("Настройки сохранены. Пароли удалены из полей формы."); }
  }
  async function command(body: unknown) {
    const result = await action.run(() => apiCall<{ message?: string }>("POST", base + "/control", body));
    if (result) { setNotice(result.message ?? "Операция выполнена"); await action.run(refresh); }
    return result;
  }
  async function nativeDialog(kind: "pick-directory" | "native-export" | "pick-archive", backupId?: string) {
    if (nativePending) return;
    setNativePending(true);
    setNotice(kind === "pick-archive" ? "Выберите зашифрованный файл .crmbackup в системном диалоге. Подготовка большого архива может занять время." : "Ожидание системного диалога…");
    try {
    const request = await action.run(() => apiCall<{ requestId: string }>("POST", base + "/control", { action: kind, ...(backupId ? { backupId } : {}) }));
    if (!request) return;
    await action.run(async () => {
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const result = await apiCall<{ status: string; directory?: string }>("POST", base + "/control", { action: "native-result", requestId: request.requestId });
        if (result.status === "pending") continue;
        if (kind === "pick-archive" && result.status === "selected") {
          setImportRequestId(request.requestId); openOperation("restore-from-file");
          setNotice("Архив подготовлен. Введите кодовую фразу или ключ. Содержимое будет проверено до восстановления; выбор действует 15 минут.");
          return;
        }
        if (result.directory && destination && (destination.kind === "local" || destination.kind === "removable")) { setDestination({ ...destination, directory: result.directory }); setDirty(true); }
        setNotice(result.status === "exported" ? "Архив проверен и сохранён на накопитель" : result.status === "failed" ? "Операция с файлом не выполнена: проверьте формат, размер, носитель и свободное место" : result.status === "cancelled" ? "Выбор отменён" : "Каталог выбран");
        return;
      }
      setNotice("Системный диалог не ответил. Повторите выбор.");
    });
    } finally { setNativePending(false); }
  }
  async function showList(id?: string) {
    setSourceId(id); setSelected("");
    const result = id ? await action.run(() => apiCall<{ archives: ArchiveRef[] }>("POST", base + "/control", { action: "list", destinationId: id })) : { archives: status?.archives ?? [] };
    if (result) { setCatalog(result.archives); setDialog("list"); }
  }
  function openOperation(kind: typeof dialog, id?: string) { setSourceId(id); setDialog(kind); setPhrase(""); setKey(""); setSaved(false); setConfirmed(false); }
  async function submitOperation() {
    if (!dialog) return;
    const body = dialog === "create" || dialog === "give" ? { action: dialog, passphrase: phrase, recoveryKey: key, recoveryKeySaved: saved, ...(sourceId ? { destinationId: sourceId } : {}) }
      : { action: dialog, ...(dialog === "restore-from-file" ? { requestId: importRequestId } : { backupId: selected, ...(sourceId ? { destinationId: sourceId } : {}) }), ...(phrase ? { passphrase: phrase } : {}), ...(key ? { recoveryKey: key } : {}), confirmed };
    if (await command(body)) { setPhrase(""); setKey(""); setDialog(null); setDirty(false); }
  }
  const close = () => { setSettings(savedSettings.current); setDestination(null); setDialog(null); setPassword(""); setAccessKeyId(""); setPhrase(""); setKey(""); setDirty(false); };
  if (!settings || !status) return <div className="space-y-4"><h1>Локальная установка и резервные копии</h1><FormErrorBanner error={action.error} /><p role="status">{action.pending ? "Загрузка…" : "Настройки недоступны"}</p><button className="btn" onClick={() => void action.run(refresh)}>Обновить данные</button></div>;
  const localArchives = status.archives as ArchiveRef[];
  return <div className="space-y-5" aria-busy={action.pending || nativePending}>
    <header className="space-y-1"><h1 className="text-xl font-semibold tracking-tight">Локальная установка и резервные копии</h1><p className="muted text-sm">Резервирование и облачные подключения доступны руководителю.</p></header>
    <FormErrorBanner error={action.error} />
    {status.nativeDialog && status.restoreSupported && <button className="btn" disabled={action.pending || nativePending} onClick={() => void nativeDialog("pick-archive")}>{nativePending ? "Подготовка файла…" : "Восстановить из файла…"}</button>}
    {action.error?.code === "STALE_UPDATE" && <button className="btn" onClick={() => void action.run(refresh)}>Обновить данные</button>}
    {notice && <p className="alert alert-success" role="status">{notice}</p>}
    <section className="card card-body space-y-3" aria-label="Состояние установки"><h2 className="card-title">{status.mode === "desktop" ? "Работает локально" : "Работает на сервере"}</h2><dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[12rem_minmax(0,1fr)] [&>dt]:text-slate-500 [&>dd]:break-words [&>dd]:font-medium"><dt>Версия</dt><dd>{status.version}</dd><dt>Размещение данных</dt><dd>{status.dataLocation}</dd><dt>Файлы</dt><dd>{bytes(status.storageBytes)}</dd><dt>Свободно на диске файлов</dt><dd>{bytes(status.freeBytes)}</dd><dt>Последнее сохранение</dt><dd>{date(localArchives[0]?.createdAtUtc)}</dd><dt>Самопроверка</dt><dd>{status.selfCheck}</dd></dl><button className="btn" disabled={action.pending} onClick={() => void action.run(refresh)}>Самопроверка / обновить</button></section>
    <p className="alert alert-warning">Шифрование переносимых архивов обязательно. Сохраните ключ восстановления отдельно от копии: без ключа и кодовой фразы восстановление невозможно. Облачные пароли при переносе подключаются заново.</p>
    {!settings.secretStorage.available && <p className="alert alert-warning">Защищённое хранилище ключей недоступно. Обратитесь к администратору; новые облачные пароли сохранить нельзя.</p>}
    {status.freeBytes !== null && status.freeBytes < 1024 ** 3 && <p role="alert" className="alert alert-warning">Мало свободного места. Освободите диск, сохранив последнюю проверенную копию.</p>}
    <div className="flex flex-wrap gap-2"><button className="btn btn-primary" disabled={action.pending} onClick={() => openOperation("create")}>Создать копию</button><button className="btn" onClick={() => setDialog("schedule")}>Настроить расписание</button><button className="btn" onClick={() => void showList()}>Восстановить</button><button className="btn" onClick={() => void showList()}>Экспорт на накопитель</button><button className="btn" disabled={!status.restoreSupported} onClick={() => openOperation("give")}>Перенести работу на другой компьютер</button><button className="btn" onClick={() => { setSelected(localArchives[0]?.backupId ?? ""); openOperation("verify"); }}>Проверить архив</button></div>
    <div className="grid gap-4 lg:grid-cols-2">{(Object.keys(names) as Kind[]).map(kind => {
      const d = settings.destinations.find(d => d.kind === kind);
      const rows = status.rows.filter(r => r.destinationId === d?.id);
      const verified = rows.filter(r => r.status === "verified").sort((a, b) => b.archive.createdAtUtc.localeCompare(a.archive.createdAtUtc))[0];
      return <section className="card card-body space-y-3" key={kind} aria-label={names[kind]}><h2 className="card-title">{names[kind]}</h2><p>{d?.enabled ? "Подключено" : "Не подключено"} · {rows.some(r => r.status === "failed") ? "Есть ошибка передачи" : verified ? "Копия проверена" : "Ожидает проверки"}</p><p>Последняя проверенная копия: {date(verified?.archive.createdAtUtc)}</p>
        <div className="flex flex-wrap gap-2"><button className="btn" onClick={() => { if (d) { const { credentialsConfigured: _flag, ...config } = d; void _flag; setDestination(config); } else setDestination(newDestination(kind)); setDirty(false); }}>Настроить {names[kind]}</button><button className="btn" disabled={!d?.enabled || action.pending} onClick={() => void command({ action: "probe", destinationId: d!.id })}>Проверить подключение</button><button className="btn" disabled={!d?.enabled} onClick={() => openOperation("create", d!.id)}>Сделать тестовую копию</button><button className="btn" disabled={!d?.enabled} onClick={() => void showList(d!.id)}>Список копий / восстановить</button></div>
        {kind === "yandex_s3" && <p className="text-sm">Object Storage — не бесплатно; это отдельный сервис от Яндекс.Диска и ИИ. Тариф API недоступен: оценка = размер копии × число поколений × тариф хранения + запросы и исходящий трафик. Версионирование увеличивает расход.</p>}
        {kind === "mailru_webdav" && <p className="text-sm">Копии расходуют квоту Mail.ru. WebDAV не гарантирует выдачу тарифа и квоты; проверьте остаток и лимит файла в личном кабинете. Используйте пароль внешнего приложения.</p>}
      </section>;
    })}</div>
    <section className="card card-body space-y-3"><h2 className="card-title">Журнал попыток и очередь</h2><p>После восстановления сети работающий worker повторяет доступ к провайдеру с увеличением интервала. Успех одного направления не отменяет ошибку другого.</p>{status.rows.length ? <div className="table-scroll rounded-lg border border-slate-200"><table className="table"><thead><tr><th>Копия / время</th><th>Направление</th><th>Объём</th><th>Состояние</th><th>Попытки / следующий повтор</th><th>Причина / действие</th></tr></thead><tbody>{status.rows.map(r => <tr key={r.archive.backupId + r.destinationId}><td>{r.archive.backupId.slice(0, 8)}<br />{date(r.archive.createdAtUtc)}</td><td>{names[settings.destinations.find(d => d.id === r.destinationId)?.kind ?? "local"]}</td><td>{bytes(r.archive.size)}</td><td>{stateNames[r.status]}</td><td>{r.attempts} / {r.nextAttemptAt ? date(new Date(r.nextAttemptAt).toISOString()) : "—"}</td><td>{r.errorCode ? "Передача не выполнена: сеть, права доступа или носитель. Проверьте подключение." : "—"}{r.status === "failed" && <button className="btn" disabled={action.pending} onClick={() => void command({ action: "retry", backupId: r.archive.backupId, destinationId: r.destinationId })}>Повторить это направление</button>}</td></tr>)}</tbody></table></div> : <p>Попыток пока нет. Создайте первую копию.</p>}
      {status.jobs.length > 0 && <ul aria-label="Операции резервирования">{status.jobs.map(j => <li key={j.id}>{date(j.createdAt)} · {j.action === "create" ? "Создание копии" : j.action === "restore" ? "Восстановление" : j.action === "verify" ? "Проверка архива" : "Перенос состояния"} · {stateNames[j.status ?? "queued"] ?? "Ожидает проверки"}{j.status === "failed" && " — операция не завершена; проверьте ключ, носитель, сеть и свободное место"}</li>)}</ul>}
    </section>
    <Modal open={!!destination} onClose={close} title={destination ? `Подключение: ${names[destination.kind]}` : "Подключение"}>{destination && <form className="space-y-4" onChange={() => setDirty(true)} onSubmit={e => { e.preventDefault(); const config = { ...destination, ...(destination.kind === "yandex_s3" && password ? { credentials: { accessKeyId, secretAccessKey: password } } : {}), ...(destination.kind === "mailru_webdav" && password ? { applicationPassword: password } : {}) }; void save([...settings.destinations.filter(d => d.id !== destination.id), config as Settings["destinations"][number]]); }}>
      <FormErrorBanner error={action.error} /><label className="flex items-start gap-2 text-sm leading-5 text-slate-700"><input className="mt-0.5 size-4 shrink-0 accent-blue-600" type="checkbox" checked={destination.enabled} onChange={e => setDestination({ ...destination, enabled: e.target.checked })} /> Включено</label>
      {(destination.kind === "local" || destination.kind === "removable") && <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">Каталог на компьютере CRM<input required className="input w-full" value={destination.directory} onChange={e => setDestination({ ...destination, directory: e.target.value })} /><span className="text-xs font-normal leading-5 text-slate-500">{status.mode === "server" ? "Путь серверного volume, а не диска браузера." : "Укажите локальный диск. Для выбора накопителя используйте системный диалог."}</span></label>}
      {(destination.kind === "local" || destination.kind === "removable") && status.nativeDialog && <button className="btn" type="button" disabled={action.pending} onClick={() => void nativeDialog("pick-directory")}>Выбрать накопитель…</button>}
      {destination.kind === "yandex_s3" && <><label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">Bucket<input className="input" required value={destination.bucket} onChange={e => setDestination({ ...destination, bucket: e.target.value })} /></label><p>Endpoint: {destination.endpoint} · {destination.region}</p><label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">Access key ID (новый)<input className="input" autoComplete="off" value={accessKeyId} onChange={e => setAccessKeyId(e.target.value)} /></label></>}
      {destination.kind === "mailru_webdav" && <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">Email<input className="input" required type="email" value={destination.email} onChange={e => setDestination({ ...destination, email: e.target.value })} /></label>}
      {(destination.kind === "yandex_s3" || destination.kind === "mailru_webdav") && <><label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">Префикс установки<input className="input" required value={destination.prefix} onChange={e => setDestination({ ...destination, prefix: e.target.value })} /></label><label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">{destination.kind === "yandex_s3" ? "Secret access key" : "Пароль внешнего приложения"}<input className="input" aria-label={destination.kind === "yandex_s3" ? "Secret access key" : "Пароль внешнего приложения"} type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /><span className="block text-xs font-normal leading-5 text-slate-500">Пустое поле сохраняет прежний секрет. Секреты никогда не возвращаются в браузер.</span></label></>}
      <button className="btn btn-primary" disabled={action.pending}>Сохранить направление</button><button type="button" className="btn" onClick={close}>Отмена</button>
    </form>}</Modal>
    <Modal open={dialog === "schedule"} onClose={close} title="Расписание и хранение"><form className="space-y-4" onChange={() => setDirty(true)} onSubmit={e => { e.preventDefault(); void save(); }}><FormErrorBanner error={action.error} />
      <label className="flex items-start gap-2 text-sm leading-5 text-slate-700"><input className="mt-0.5 size-4 shrink-0 accent-blue-600" type="checkbox" checked={settings.schedule.enabled} onChange={e => setSettings({ ...settings, schedule: { ...settings.schedule, enabled: e.target.checked } })} /> Автоматические копии</label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">Часовой пояс<input className="input" required value={settings.schedule.timeZone} onChange={e => setSettings({ ...settings, schedule: { ...settings.schedule, timeZone: e.target.value } })} /></label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">Периодичность<select className="input" value={settings.schedule.frequency} onChange={e => setSettings({ ...settings, schedule: { ...settings.schedule, frequency: e.target.value as "daily" | "weekly" } })}><option value="daily">Ежедневно</option><option value="weekly">Еженедельно</option></select></label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">Время<input className="input" required type="time" value={`${String(settings.schedule.hour).padStart(2, "0")}:${String(settings.schedule.minute).padStart(2, "0")}`} onChange={e => { const [hour = 0, minute = 0] = e.target.value.split(":").map(Number); setSettings({ ...settings, schedule: { ...settings.schedule, hour, minute } }); }} /></label>
      {settings.schedule.frequency === "weekly" && <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">День недели<select className="input" value={settings.schedule.weekday} onChange={e => setSettings({ ...settings, schedule: { ...settings.schedule, weekday: Number(e.target.value) } })}>{["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"].map((day, i) => <option key={day} value={i}>{day}</option>)}</select></label>}
      <label className="flex items-start gap-2 text-sm leading-5 text-slate-700"><input className="mt-0.5 size-4 shrink-0 accent-blue-600" type="checkbox" checked={settings.schedule.onClose} onChange={e => setSettings({ ...settings, schedule: { ...settings.schedule, onClose: e.target.checked } })} /> При завершении</label>
      <p>Защитная копия перед обновлением обязательна. После сна или выключения восполняется максимум один интервал. В desktop задания выполняются, пока CRM работает или свёрнута в трей. Сначала создайте ручную копию с сохранённым ключом, чтобы разрешить автоматическое шифрование.</p>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">Хранить поколений (не менее 2)<input className="input" type="number" min="2" max="1000" value={settings.retention.keep} onChange={e => setSettings({ ...settings, retention: { ...settings.retention, keep: Number(e.target.value) } })} /></label><label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">Срок, дней<input className="input" type="number" min="1" value={settings.retention.maxAgeDays} onChange={e => setSettings({ ...settings, retention: { ...settings.retention, maxAgeDays: Number(e.target.value) } })} /></label>
      <button className="btn btn-primary" disabled={action.pending}>Сохранить расписание</button>
    </form></Modal>
    <Modal open={dialog === "list"} onClose={close} title="Список копий"><FormErrorBanner error={action.error} />{catalog.length ? <><label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">Выберите копию<select className="input" value={selected} onChange={e => setSelected(e.target.value)}><option value="">Выберите…</option>{catalog.map(a => <option key={a.backupId} value={a.backupId}>{date(a.createdAtUtc)} · {bytes(a.size)} · {a.backupId.slice(0, 8)}</option>)}</select></label><div className="flex flex-wrap gap-2">{(["verify", "restore", "compare", "receive"] as const).map((op, i) => <button className="btn" key={op} disabled={!selected || (op !== "verify" && !status.restoreSupported)} onClick={() => openOperation(op, sourceId)}>{["Проверить архив", "Восстановить", "Сравнить с локальной версией", "Получить состояние"][i]}</button>)}{!sourceId && selected && (status.nativeDialog ? <button className="btn" disabled={action.pending} onClick={() => void nativeDialog("native-export", selected)}>Экспорт на накопитель…</button> : <a className="btn" href={`${base}/archives/${selected}`}>Скачать архив на накопитель</a>)}</div><p>Скачивание сохраняет зашифрованный архив; выберите накопитель в диалоге сохранения браузера.</p></> : <p>Проверенных копий в этом источнике пока нет.</p>}</Modal>
    <Modal open={!!dialog && !["list", "schedule"].includes(dialog)} onClose={close} title={dialog === "give" ? "Передать состояние на другой ПК" : dialog === "create" ? "Создать зашифрованную копию" : "Проверка и восстановление"}>
      <form className="space-y-4" onChange={() => setDirty(true)} onSubmit={e => { e.preventDefault(); void submitOperation(); }}><FormErrorBanner error={action.error} />
        {dialog === "restore-from-file" && <p>Выбранный файл будет расшифрован и полностью проверен. До замены данных supervisor остановит запись и создаст защитную локальную копию. Облачный каталог и файл метаданных рядом с архивом не нужны. Выбор одноразовый: после ошибки закройте форму и выберите файл заново.</p>}
        {dialog !== "create" && dialog !== "give" && dialog !== "restore-from-file" && <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">Идентификатор архива<input className="input" required value={selected} onChange={e => setSelected(e.target.value)} /></label>}
        <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">Кодовая фраза<input className="input" type="password" autoComplete="new-password" minLength={12} required={dialog === "create" || dialog === "give"} value={phrase} onChange={e => setPhrase(e.target.value)} /></label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">Ключ восстановления<input className="input" type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} /></label>
        {(dialog === "create" || dialog === "give") && <><button type="button" className="btn" onClick={() => void recoveryKey().then(value => { setKey(value); setSaved(false); })}>Сформировать ключ</button><button type="button" className="btn" disabled={!key} onClick={() => download(key, "CRM-recovery-key.txt")}>Экспорт ключа на носитель</button><label className="flex items-start gap-2 text-sm leading-5 text-slate-700"><input className="mt-0.5 size-4 shrink-0 accent-blue-600" type="checkbox" required checked={saved} onChange={e => setSaved(e.target.checked)} /> Я сохранил ключ отдельно от архива</label></>}
        {(dialog === "restore" || dialog === "receive" || dialog === "restore-from-file") && <label className="flex items-start gap-2 text-sm leading-5 text-slate-700"><input className="mt-0.5 size-4 shrink-0 accent-blue-600" type="checkbox" required checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> Подтверждаю замену состояния после проверки и защитной копии. При конфликте версий автоматического объединения нет.</label>}
        {dialog === "give" && <p>После передачи исходный ПК прекращает запись. На другом ПК сравните и получите состояние. Работа с двух ПК одновременно не поддерживается.</p>}
        <p>Полный диск, отсутствие сети, неверные ключи или несовместимая версия останавливают операцию. Последняя пригодная копия сохраняется.</p>
        <button className="btn btn-primary" disabled={action.pending}>Выполнить</button><button className="btn" type="button" onClick={close}>Отмена</button>
      </form>
    </Modal>
  </div>;
}
