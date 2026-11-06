// TRUSTED LOCAL ONLY. Agents and CI must supply synthetic workbooks exclusively.
// The generated private HTML contains headers/structure only and runs offline on file:.
import { readFile, mkdir, open, realpath, unlink, lstat } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

let domainPromise;
async function domain() {
    domainPromise ??= import('tsx/esm/api').then(({ tsImport }) => tsImport(
        new URL('../../src/modules/import/domain/enterprise-workbook.ts', import.meta.url).href,
        { parentURL: import.meta.url, tsconfig: fileURLToPath(new URL('../../tsconfig.json', import.meta.url)) }));
    return domainPromise;
}
const fieldLabels = {
    addressText: 'Адрес объекта', district: 'Район', area: 'Площадь, м²', floor: 'Этаж',
    propertyTypeText: 'Назначение объекта', operationText: 'Операция', price: 'Цена / ставка', priceUnit: 'Единица цены',
    description: 'Описание', stateMark: 'Статус / метка', ownerName: 'Имя собственника', ownerPhone: 'Телефон собственника',
    receivedDate: 'Дата обращения / сделки', name: 'Имя клиента / контрагента', phone: 'Телефон клиента', email: 'Email клиента',
    request: 'Запрос клиента', source: 'Источник', responsible: 'Ответственный', comment: 'Комментарий',
    sourceRowId: 'Исходный номер строки', contractRef: 'Номер договора', commissionAmount: 'Сумма комиссии',
};

export async function createMappingReview(workbook) {
    const { buildProfile, detectEnterpriseHeaders, fields, excludedHeader } = await domain();
    const profile = buildProfile(workbook);
    const sheets = workbook.worksheets.map((ws, i) => {
        const config = profile.sheets[i];
        const detected = detectEnterpriseHeaders(ws);
        const blocks = detected.map(block => ({
            row: block.row, endRow: block.endRow,
            target: config.blockTargets && Object.hasOwn(config.blockTargets, String(block.row)) ? config.blockTargets[String(block.row)] : 'inherit',
            columns: Array.from({ length: ws.columnCount }, (_, cn) => block.cells.find(c => c.column === cn + 1) ?? { column: cn + 1, header: `@${block.row}:${cn + 1}` }).map(cell => {
                const coordinate = `@${block.row}:${cell.column}`;
                const key = normalizeHeader(cell.header);
                const excluded = excludedHeader(cell.header);
                return { column: cell.column, header: /^@\d+:\d+$/.test(cell.header) ? '' : cell.header, key,
                    excluded, field: excluded ? 'ignore' : Object.hasOwn(config.columns, coordinate) ? config.columns[coordinate] : config.columns[key] ?? null };
            }),
        }));
        if (!blocks.length) blocks.push({ row: 1, endRow: 1, target: 'inherit', columns: Array.from({ length: ws.columnCount }, (_, c) => ({ column: c + 1, header: '', key: '', excluded: false, field: null })) });
        return { index: i + 1, name: ws.name, rows: ws.rowCount, columns: ws.columnCount, hidden: ws.state !== 'visible',
            manualHeader: !detected.length, target: config.target, operation: config.defaults.operationType ?? '', priceUnit: config.defaults.priceUnit ?? '', blocks };
    });
    return { profile, fields: fields.map(code => ({ code, label: fieldLabels[code] })), sheets };
}

// Mirrors the profile key normalization, without importing server code in the HTML.
function normalizeHeader(value) {
    return String(value ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[\s ]+/g, ' ')
        .replace(/\s*([/,.:()-])\s*/g, '$1').replace(/:$/, '').trim();
}

/** This function is serialized as a static nonced script. All source text uses textContent. */
function mappingReviewBrowser() {
    'use strict';
    const model = JSON.parse(document.getElementById('review-data').textContent);
    const choices = [['', 'Не определено — требуется решение'], ['property', 'Объекты'], ['client_request_need', 'Клиенты / обращения / потребности'], ['historical_deal_archive', 'Исторический архив сделок'], ['ignore', 'Не импортировать (подтверждённый пропуск)']];
    const operations = [['', 'Не задана'], ['rent', 'Аренда'], ['sale', 'Продажа']];
    const units = [['', 'Не задана'], ['rub_total', '₽ за объект'], ['rub_month', '₽ в месяц'], ['rub_m2', '₽ за м²'], ['rub_m2_month', '₽ за м² в месяц'], ['rub_year', '₽ в год'], ['rub_m2_year', '₽ за м² в год']];
    const fieldChoices = [['', 'Не определено — требуется решение'], ['ignore', 'Не импортировать (подтверждённый пропуск)'], ...model.fields.map(f => [f.code, `${f.label} (${f.code})`])];
    const allowedTargets = new Set(choices.slice(1).map(c => c[0]));
    const allowedFields = new Set(fieldChoices.slice(1).map(c => c[0]));
    const allowedUnits = new Set(units.map(c => c[0]));
    const controls = [];
    const content = document.getElementById('sheets');
    const errorsElement = document.getElementById('errors');
    const owner = document.getElementById('owner-confirmed');
    const download = document.getElementById('download');
    function element(tag, text, parent) {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (parent) parent.append(node);
        return node;
    }
    function select(label, items, value, parent, id) {
        const wrapper = element('label', label, parent);
        const control = element('select', undefined, wrapper);
        control.id = id;
        for (const [code, title] of items) {
            const option = element('option', title, control);
            option.value = code;
        }
        control.value = value ?? '';
        return control;
    }
    for (const sheet of model.sheets) {
        const section = element('section', undefined, content);
        element('h2', `Лист ${sheet.index}: ${sheet.name}`, section);
        element('p', `Строк: ${sheet.rows}; столбцов: ${sheet.columns}.${sheet.hidden ? ' Лист скрыт.' : ''}`, section);
        const settings = element('div', undefined, section);
        settings.className = 'settings';
        const target = select(`Тип листа ${sheet.index}`, choices, sheet.target, settings, `target-${sheet.index}`);
        const operation = select(`Операция по умолчанию, лист ${sheet.index}`, operations, sheet.operation, settings, `operation-${sheet.index}`);
        const priceUnit = select(`Единица цены по умолчанию, лист ${sheet.index}`, units, sheet.priceUnit, settings, `price-unit-${sheet.index}`);
        let headerRow, headerConfirmed;
        if (sheet.manualHeader) {
            element('p', 'Заголовки не определены. Значения ячеек здесь не показаны. Откройте исходную книгу локально, сверьте номер строки заголовков и назначьте поля по координатам, либо явно пропустите лист.', section);
            const label = element('label', `Номер строки заголовков, лист ${sheet.index}`, section);
            headerRow = element('input', undefined, label);
            headerRow.type = 'number'; headerRow.min = '1'; headerRow.max = String(sheet.rows); headerRow.value = '';
            headerRow.id = `header-row-${sheet.index}`;
            const confirmLabel = element('label', undefined, section);
            headerConfirmed = element('input', undefined, confirmLabel); headerConfirmed.type = 'checkbox'; headerConfirmed.id = `header-confirmed-${sheet.index}`;
            confirmLabel.append(document.createTextNode('Я самостоятельно сверил номер строки заголовков и координаты по исходной книге'));
        }
        const blocks = sheet.blocks.map((block, bi) => {
            const wrapper = element('div', undefined, section);
            wrapper.className = 'block';
            element('h3', sheet.manualHeader ? 'Столбцы для ручного сопоставления' : `Кандидат заголовков: строки ${block.row}–${block.endRow}`, wrapper);
            const blockTarget = select(`Тип таблицы ${bi + 1}, лист ${sheet.index}`, [['inherit', 'Использовать тип листа'], ...choices], block.target, wrapper, `block-target-${sheet.index}-${bi}`);
            element('p', 'Сверьте, что это заголовки таблицы. Ложный кандидат явно пропустите. Для разных таблиц можно выбрать разные типы.', wrapper);
            const table = element('table', undefined, wrapper);
            const head = element('tr', undefined, element('thead', undefined, table));
            for (const title of ['Координата', 'Заголовок', 'Поле CRM']) element('th', title, head);
            const body = element('tbody', undefined, table);
            const columns = block.columns.map(column => {
                const tr = element('tr', undefined, body);
                const coordinate = element('td', sheet.manualHeader ? `R?C${column.column}` : `R${block.endRow}C${column.column}`, tr);
                element('td', column.header || 'Без распознанного заголовка', tr);
                const cell = element('td', undefined, tr);
                const field = select(`Поле R${block.row}C${column.column}, лист ${sheet.index}`, column.excluded ? [['ignore', 'Исключено политикой: запрещённые персональные поля']] : fieldChoices, column.field, cell, `field-${sheet.index}-${bi}-${column.column}`);
                field.disabled = column.excluded;
                if (column.excluded) tr.className = 'excluded';
                return { ...column, control: field, coordinate };
            });
            return { ...block, control: blockTarget, columns };
        });
        controls.push({ ...sheet, target, operation, priceUnit, headerRow, headerConfirmed, blocks });
    }

    function buildProfile() {
        const errors = [];
        const profile = JSON.parse(JSON.stringify(model.profile));
        const fail = (code, sheet, row, column) => errors.push(`${code}: лист ${sheet}${row ? `, R${row}` : ''}${column ? `C${column}` : ''}`);
        profile.sheets = controls.map(sheet => {
            const original = profile.sheets.find(s => s.index === sheet.index);
            const config = { ...original, target: sheet.target.value || null, columns: Object.create(null), blockTargets: Object.create(null), defaults: { ...original.defaults } };
            delete config.defaults.operationType; delete config.defaults.priceUnit;
            if (sheet.operation.value) config.defaults.operationType = sheet.operation.value;
            if (sheet.priceUnit.value) config.defaults.priceUnit = sheet.priceUnit.value;
            if (!allowedTargets.has(config.target)) fail('TARGET_UNRESOLVED', sheet.index);
            if (config.target === 'ignore') return { ...config, columns: {}, blockTargets: {} };
            if (!operations.some(c => c[0] === sheet.operation.value) || !allowedUnits.has(sheet.priceUnit.value)) fail('INVALID_DEFAULTS', sheet.index);
            let manualRow;
            if (sheet.manualHeader) {
                manualRow = Number(sheet.headerRow.value);
                if (!Number.isSafeInteger(manualRow) || manualRow < 1 || manualRow > sheet.rows || !sheet.headerConfirmed.checked) fail('HEADER_CONFIRMATION_REQUIRED', sheet.index);
                config.headerRow = manualRow;
            }
            const headerValues = new Map();
            for (const block of sheet.blocks) {
                const row = sheet.manualHeader ? manualRow : block.row;
                const target = block.control.value === 'inherit' ? config.target : block.control.value || null;
                config.blockTargets[String(row)] = target;
                if (!allowedTargets.has(target)) fail('TARGET_UNRESOLVED', sheet.index, row);
                if (target === 'ignore') continue;
                const mapped = [];
                for (const column of block.columns) {
                    if (column.excluded) continue;
                    const field = column.control.value || null;
                    if (!allowedFields.has(field)) fail('COLUMN_UNRESOLVED', sheet.index, row, column.column);
                    config.columns[`@${row}:${column.column}`] = field;
                    // Labels help the existing detector recognize manually mapped headers.
                    if (column.header && column.key !== '__proto__' && column.key !== 'constructor' && column.key !== 'prototype') {
                        const values = headerValues.get(column.key) ?? new Set(); values.add(field); headerValues.set(column.key, values);
                    }
                    if (field && field !== 'ignore') mapped.push({ field, column: column.column });
                }
                const fields = new Set(mapped.map(c => c.field));
                for (const column of mapped) if (!['phone', 'email'].includes(column.field) && mapped.filter(c => c.field === column.field).length > 1) fail('DUPLICATE_SINGLE_VALUE_FIELD', sheet.index, row, column.column);
                if (!mapped.length) fail('NO_MAPPED_FIELDS', sheet.index, row);
                if (target === 'property') {
                    if (!fields.has('addressText') || !fields.has('area')) fail('PROPERTY_FIELDS_REQUIRED', sheet.index, row);
                    if (!fields.has('operationText') && !sheet.operation.value) fail('OPERATION_REQUIRED', sheet.index, row);
                    if (fields.has('price') && !fields.has('priceUnit') && sheet.operation.value !== 'sale' && !sheet.priceUnit.value) fail('RENT_PRICE_UNIT_REQUIRED', sheet.index, row);
                }
                if (target === 'client_request_need' && (!fields.has('name') || !(fields.has('phone') || fields.has('email')))) fail('CLIENT_FIELDS_REQUIRED', sheet.index, row);
                if (target === 'historical_deal_archive' && !fields.has('addressText')) fail('HISTORY_ADDRESS_REQUIRED', sheet.index, row);
            }
            for (const [header, values] of headerValues) if (values.size === 1 && !values.has(null)) config.columns[header] = [...values][0];
            return config;
        });
        if (!owner.checked) errors.push('OWNER_CONFIRMATION_REQUIRED: подтвердите самостоятельную проверку');
        return { profile, errors };
    }
    function refresh() {
        for (const sheet of controls) if (sheet.manualHeader) for (const block of sheet.blocks) for (const column of block.columns) {
            column.coordinate.textContent = `R${sheet.headerRow.value || '?'}C${column.column}`;
            column.control.parentElement.firstChild.textContent = `Поле R${sheet.headerRow.value || '?'}C${column.column}, лист ${sheet.index}`;
        }
        const { errors } = buildProfile();
        errorsElement.replaceChildren();
        if (errors.length) for (const error of errors) element('li', error, errorsElement);
        else element('li', 'Решения заполнены. Можно скачать профиль для повторного dry-run.', errorsElement);
        download.disabled = errors.length > 0;
        document.getElementById('result').textContent = '';
    }
    function changed(event) { if (event.target !== owner) owner.checked = false; refresh(); }
    document.addEventListener('change', changed);
    document.addEventListener('input', changed);
    download.addEventListener('click', () => {
        const { profile, errors } = buildProfile();
        if (errors.length) { refresh(); return; }
        const blob = new Blob([JSON.stringify(profile, null, 2) + '\n'], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = element('a'); anchor.href = url; anchor.download = 'enterprise-profile-confirmed.json';
        document.body.append(anchor); anchor.click(); anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        document.getElementById('result').textContent = 'Профиль скачан. Сохраните enterprise-profile-confirmed.json в private-data/ рядом с формой. Проведите повторный dry-run с этим профилем; загрузка данных в CRM не выполнялась.';
    });
    refresh();
}

export function renderMappingReview(review) {
    const nonce = randomBytes(24).toString('base64');
    const data = JSON.stringify(review).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'none'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; media-src 'none'">
<meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Локальное подтверждение сопоставления CRM</title>
<style nonce="${nonce}">body{font:16px/1.5 system-ui,sans-serif;max-width:1250px;margin:2rem auto;padding:0 1rem;color:#172638;background:#f5f7fa}section{background:white;border:1px solid #b9c6d5;padding:1.25rem;margin:1.5rem 0}label{display:block;margin:.6rem 0}select{display:block;max-width:100%;padding:.5rem}input[type=number]{margin-left:1rem;width:6rem}table{border-collapse:collapse;width:100%;margin:1rem 0}td,th{border:1px solid #c8d0dc;padding:.5rem;text-align:left;overflow-wrap:anywhere}td:nth-child(2){max-width:32rem;white-space:pre-wrap}.settings{display:flex;gap:1rem;flex-wrap:wrap}.block{border-top:1px solid #c8d0dc;margin-top:1rem}.excluded{background:#eee;color:#555}button{font:inherit;padding:.75rem 1rem}#errors{color:#8b270e}#result{color:#15562c}.notice{background:#fff7dd;padding:1rem}</style></head>
<body><h1>Подтверждение сопоставления рабочей книги</h1>
<p class="notice">Конфиденциальная локальная форма. Работает через file:// без сети, внешних сервисов и LLM. Показаны только названия листов, кандидаты заголовков и структура; строки данных не включены. Не отправляйте эту форму и профили в Git, CI, чаты или сторонние сервисы.</p>
<p>Самостоятельно сверьте заголовки и таблицы по исходной книге. «Не определено» требует решения. «Не импортировать» означает явный пропуск. Запрещённые персональные поля исключены и недоступны для назначения. Настройки операции и цены действуют при отсутствии более точного значения в строке или явной единицы в заголовке.</p>
<noscript>Для локальной формы нужен JavaScript. Данные не отправляются по сети.</noscript><main id="sheets"></main>
<h2>Проверка решений</h2><ul id="errors" aria-live="polite"></ul>
<label><input id="owner-confirmed" type="checkbox">Я, владелец данных, самостоятельно проверил типы листов и таблиц, все сопоставления, пропуски, операцию и единицы цены. Подтверждаю эти решения.</label>
<button id="download" type="button" disabled>Скачать enterprise-profile-confirmed.json</button><p id="result" role="status"></p>
<p>Браузер предложит загрузку. Сохраните файл как <strong>private-data/enterprise-profile-confirmed.json</strong> в рабочем каталоге CRM. Если браузер сохраняет в «Загрузки», вручную перенесите файл в private-data/. Не заменяйте существующий подтверждённый профиль без отдельного решения владельца. Эта форма не загружает данные в CRM: после сохранения обязателен повторный dry-run и отдельное подтверждение commit.</p>
<script id="review-data" type="application/json" nonce="${nonce}">${data}</script>
<script nonce="${nonce}">(${mappingReviewBrowser.toString()})();</script></body></html>\n`;
}

/** Output is restricted to a private subdirectory of the chosen workspace. */
export async function prepareMappingReview(input, { workspaceRoot = process.cwd() } = {}) {
    if (typeof input !== 'string' || extname(input).toLowerCase() !== '.xlsx') throw new Error('INVALID_INPUT');
    // Windows CI TEMP may use its 8.3 alias (RUNNER~1). Canonicalize the
    // workspace before containment checks; still reject a redirected private root.
    const workspace = await realpath(resolve(workspaceRoot));
    const root = join(workspace, 'private-data');
    await mkdir(root, { recursive: true, mode: 0o700 });
    if ((await lstat(root)).isSymbolicLink() || (await realpath(root)).toLowerCase() !== root.toLowerCase()) throw new Error('INVALID_PRIVATE_OUTPUT');
    const htmlPath = join(root, 'mapping-review.html');
    const candidatePath = join(root, `enterprise-profile-candidate-${randomUUID()}.json`);
    const handles = [];
    const created = [];
    try {
        // Exclusive creation also refuses symlinks and existing files; never replace a review.
        const html = await open(htmlPath, 'wx', 0o600); handles.push(html); created.push(htmlPath);
        const candidate = await open(candidatePath, 'wx', 0o600); handles.push(candidate); created.push(candidatePath);
        const { loadEnterprise } = await domain();
        const workbook = await loadEnterprise(await readFile(resolve(workspaceRoot, input)));
        const review = await createMappingReview(workbook);
        await candidate.writeFile(JSON.stringify(review.profile, null, 2) + '\n');
        await html.writeFile(renderMappingReview(review));
        await Promise.all(handles.map(handle => handle.close())); handles.length = 0;
        return { code: 'MAPPING_REVIEW_READY', sheets: review.sheets.length, blocks: review.sheets.reduce((n, s) => n + s.blocks.length, 0),
            columns: review.sheets.reduce((n, s) => n + s.blocks.reduce((sum, b) => sum + b.columns.length, 0), 0),
            unresolvedTargets: review.sheets.filter(s => s.target === null).length,
            unresolvedColumns: review.sheets.reduce((n, s) => n + s.blocks.reduce((sum, b) => sum + b.columns.filter(c => c.field === null && !c.excluded).length, 0), 0),
            excludedColumns: review.sheets.reduce((n, s) => n + s.blocks.reduce((sum, b) => sum + b.columns.filter(c => c.excluded).length, 0), 0) };
    } catch (error) {
        await Promise.allSettled(handles.map(handle => handle.close()));
        // Only exact newly-created files are removed, within the verified private root.
        await Promise.allSettled(created.map(path => unlink(path)));
        throw error;
    }
}

export async function main(args = process.argv.slice(2)) {
    const output = process.stdout.write.bind(process.stdout);
    const stderr = process.stderr.write;
    const stdout = process.stdout.write;
    process.stdout.write = () => true;
    process.stderr.write = () => true;
    try {
        if (args.length !== 1) throw new Error('INVALID_ARGUMENTS');
        output(JSON.stringify(await prepareMappingReview(args[0])) + '\n');
        return 0;
    } catch (error) {
        output(JSON.stringify({ code: error?.code === 'EEXIST' ? 'MAPPING_REVIEW_OUTPUT_EXISTS' : 'MAPPING_REVIEW_FAILED' }) + '\n');
        return 1;
    } finally { process.stdout.write = stdout; process.stderr.write = stderr; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main();
