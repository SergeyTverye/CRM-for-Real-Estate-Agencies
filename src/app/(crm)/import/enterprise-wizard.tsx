"use client";
import { useState } from 'react';
import { apiCall } from '@/ui/api-client';
import { useApiAction, useUnsavedChangesWarning } from '@/ui/hooks';
import { FormErrorBanner } from '@/ui/form';
import type { EnterpriseProfile } from '@/modules/import/domain/enterprise-workbook';
export type EnterpriseReport = {
    id: string;
    status?: string;
    profile: EnterpriseProfile;
    mappingVersion?: string;
    unresolved: {
        sheet: number;
        row: number;
        column: number;
    }[];
    rowsImported?:number;rowsSkipped?:number;rowsError?:number;
    counts: Record<string, number>;
    checksumRepeated: boolean;
    rows?: {
        sheetName: string;
        sourceSection: string;
        sourceRowNumber: number;
        validationStatus: string;
        commitResult: string | null;
        errorCodes: string[];
        warningCodes: string[];
    }[];
};
export function EnterpriseImportWizard({ initialReport }: {
    initialReport?: EnterpriseReport;
}) {
    const [compatibility, setCompatibility] = useState<Record<string, number> | null>(null);
    const [mode, setMode] = useState('auto'), [file, setFile] = useState<File | null>(null), [profileFile, setProfileFile] = useState<File | null>(null), [report, setReport] = useState<EnterpriseReport | null>(initialReport ?? null), [confirmed, setConfirmed] = useState(false), [warnings, setWarnings] = useState(false), [edited, setEdited] = useState('');
    const { run, pending, error } = useApiAction();
    useUnsavedChangesWarning(Boolean(file && !report) || Boolean(edited));
    async function reload(id: string) { const r = await apiCall<EnterpriseReport>('GET', `/api/v1/import/enterprise/${id}`); setReport(r); setEdited(''); setConfirmed(false); }
    return <section className="mb-4 rounded border bg-white p-4"><h2 className="mb-2 text-lg font-semibold">Рабочая книга объектов и обращений</h2>
 <p className="mb-3 text-sm">Шаг 1: профиль и файл → 2: проверка по листам и разделам → 3: подтверждение → загрузка. Доступно руководителю. Книга хранится как защищённый шаблон.</p>
 <label className="mr-3">Профиль <select value={mode} onChange={e => setMode(e.target.value)} disabled={pending}><option value="auto">Автоопределение v2 (нужна проверка)</option><option value="custom">Локальный профиль v2 JSON</option></select></label>
 {mode === 'custom' && <label>Профиль JSON <input type="file" accept=".json" disabled={pending} onChange={e => setProfileFile(e.target.files?.[0] ?? null)}/></label>}
 <label className="block my-3">Синтетическая или разрешённая локальная книга .xlsx <input type="file" accept=".xlsx" disabled={pending} onChange={e => { setFile(e.target.files?.[0] ?? null); setReport(null); }}/></label>
 <button className="btn btn-primary" disabled={pending || !file || (mode === 'custom' && !profileFile)} onClick={() => run(async () => { const f = new FormData(); f.set('file', file!); if (mode === 'custom' && profileFile)
        f.set('profile', await profileFile.text()); const r = await apiCall<EnterpriseReport>('POST', '/api/v1/import/enterprise', f); await reload(r.id); })}>{pending ? 'Выполняется…' : 'Проверить без загрузки в CRM'}</button>
 <FormErrorBanner error={error}/>
 {report && <div className="mt-4 space-y-3"><p>Статус: {report.status==='completed'?'Завершён':report.status==='dry_run_ready'?'Проверен':report.status}. Строк: {report.counts.total ?? 0}. Ошибки: {report.counts.invalid ?? 0}. Скрыто/пропущено: {report.counts.skipped_policy ?? 0}. {report.checksumRepeated ? 'Такой файл уже проверялся.' : ''}</p>
 <details><summary>Настройка сопоставления колонок и скрытых строк</summary><p className="text-sm">Для unresolved назначьте поле CRM или «ignore» (подтверждённый пропуск). null требует решения. Исключённые политикой поля не импортируются.</p><textarea aria-label="Профиль v2" className="w-full border font-mono text-xs" rows={14} value={edited || JSON.stringify(report.profile, null, 2)} onChange={e => setEdited(e.target.value)}/><button className="btn" disabled={pending || !edited || report.status === 'completed'} onClick={() => run(async () => { await apiCall('PATCH', `/api/v1/import/enterprise/${report.id}`, JSON.parse(edited)); await reload(report.id); })}>Применить профиль и повторить dry-run</button></details>
 {report.unresolved.length > 0 && <p role="alert">Требуют решения: {report.unresolved.map(c => `лист ${c.sheet}, R${c.row}C${c.column}`).join('; ')}</p>}
 <details><summary>Предпросмотр по листам и разделам (координаты и коды)</summary>{!report.rows?.length ? <p>Нет распознанных строк. Проверьте профиль.</p> : <div className="max-h-80 overflow-auto"><table className="table"><thead><tr><th>Лист</th><th>Раздел</th><th>Строка</th><th>Проверка</th><th>Коды</th><th>Загрузка</th></tr></thead><tbody>{report.rows.map((r, i) => <tr key={i}><td>{r.sheetName}</td><td>{r.sourceSection}</td><td>{r.sourceRowNumber}</td><td>{r.validationStatus}</td><td>{[...r.errorCodes, ...r.warningCodes].join(', ')}</td><td>{r.commitResult ?? '—'}</td></tr>)}</tbody></table></div>}</details>
 {report.status !== 'completed' ? <><label className="block"><input type="checkbox" checked={warnings} onChange={e => setWarnings(e.target.checked)}/> Предупреждения проверены; неоднозначные сведения потребуют ручного уточнения</label><label className="block"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/> Подтверждаю загрузку допустимых строк, пропуск ошибок и дублей</label><button className="btn btn-primary" disabled={pending || !confirmed || !warnings || report.unresolved.length > 0 || Boolean(edited)} onClick={() => run(async () => { await apiCall('POST', `/api/v1/import/enterprise/${report.id}`, { confirmed: true, acceptWarnings: warnings, expectedMappingVersion: report.mappingVersion }); await reload(report.id); })}>Загрузить в CRM</button></> : <><p role="status">Импорт завершён.</p><p>Загружено: {report.rowsImported??0}; пропущено: {report.rowsSkipped??0}; ошибок записи: {report.rowsError??0}.</p><a className="link" href={`/api/v1/import/enterprise/${report.id}/export`}>В формат рабочего Excel</a><button className="btn ml-3" disabled={pending} onClick={() => run(async () => { const response = await fetch(`/api/v1/import/enterprise/${report.id}/export`); if (!response.ok)
            throw new Error('EXPORT_FAILED'); const value = response.headers.get('X-Import-Compatibility'); setCompatibility(value ? JSON.parse(value) : {}); })}>Отчёт совместимости</button>{compatibility && <pre className="text-xs">{JSON.stringify(compatibility, null, 2)}</pre>}<p className="text-sm">Данные без источника CRM очищаются. Ссылки из CRM сохраняются; остальные очищаются. Отчёт несовместимостей доступен ниже.</p></>}
 </div>}
 </section>;
}
