import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX = 32 * 1024 * 1024;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { safeCode: code }); };
const requireThat = (condition, code) => { if (!condition) fail(code); };
const uuid = value => { requireThat(typeof value === 'string' && UUID.test(value), 'BC_UUID_REJECTED'); return value; };

export function validateBase(value) {
  requireThat(typeof value === 'string' && /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(value), 'BC_BASE_REJECTED');
  const port = Number(value.split(':').at(-1));
  requireThat(port <= 65535, 'BC_BASE_REJECTED');
  return value;
}
export function validateDirectory(value) {
  requireThat(typeof value === 'string' && /^[a-z]:[\\/]/i.test(value) &&
    !/[\x00-\x1f<>"|?*]/.test(value) && !value.slice(2).includes(':') &&
    !value.split(/[\\/]/).some(p => p === '.' || p === '..' || /[ .]$/.test(p)), 'BC_DIRECTORY_REJECTED');
  const normalized = path.win32.normalize(value);
  const root = path.win32.join(workspace, 'data', 'qa-v32-installed-browser');
  const relative = path.win32.relative(root, normalized);
  requireThat(new RegExp(`^run-${UUID.source.slice(1, -1)}\\\\business-cycle$`, 'i').test(relative), 'BC_DIRECTORY_REJECTED');
  return normalized;
}

async function canonicalDirectory(directory) {
  let cursor = directory;
  while (true) {
    const stat = await fs.lstat(cursor);
    requireThat(stat.isDirectory() && !stat.isSymbolicLink(), 'BC_PATH_REJECTED');
    requireThat((await fs.realpath(cursor)).toLowerCase() === cursor.toLowerCase(), 'BC_PATH_REJECTED');
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

function zipContents(bytes, unzipSync) {
  requireThat(bytes.length > 4 && bytes.readUInt32LE(0) === 0x04034b50, 'BC_ZIP_REJECTED');
  let total = 0, count = 0;
  const entries = unzipSync(bytes, { filter(entry) {
    count++;
    total += entry.originalSize;
    requireThat(Number.isSafeInteger(total) && total <= MAX && count <= 512 &&
      !entry.name.startsWith('/') && !entry.name.includes('\\') &&
      !entry.name.split('/').some(p => p === '..') && !entry.name.includes(':'), 'BC_ZIP_REJECTED');
    return true;
  } });
  requireThat(count > 0 && Object.keys(entries).length === count, 'BC_ZIP_REJECTED');
  return entries;
}
const text = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

function csvRows(bytes) {
  const source = text(bytes).replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (c === ',' || c === '\n')) {
      row.push(cell); cell = '';
      if (c === '\n') { rows.push(row); row = []; }
    } else if (!quoted && c === '\r') {
      requireThat(source[i + 1] === '\n', 'BC_CSV_REJECTED');
    } else cell += c;
  }
  requireThat(!quoted && row.length === 0 && cell === '' && rows.length >= 1, 'BC_CSV_REJECTED');
  const columns = rows.shift();
  requireThat(new Set(columns).size === columns.length, 'BC_CSV_REJECTED');
  return rows.map(values => {
    requireThat(values.length === columns.length, 'BC_CSV_REJECTED');
    return Object.fromEntries(columns.map((key, i) => [key, values[i]]));
  });
}

export async function runInstalledBusinessCycle({ page, base, clientId, directory }) {
  let stage = 'BC_PREFLIGHT_FAILED';
  const checks = [], files = [];
  const pass = code => checks.push({ code, status: 'PASS' });
  try {
    requireThat(process.platform === 'win32', 'BC_WINDOWS_REQUIRED');
    validateBase(base); uuid(clientId);
    directory = validateDirectory(directory);
    requireThat(new URL(page.url()).origin === base && page.request === page.context().request &&
      !page.isClosed(), 'BC_SESSION_CONTEXT_REJECTED');
    await canonicalDirectory(path.dirname(directory));
    await fs.mkdir(directory, { recursive: false });
    await canonicalDirectory(directory);
    const { unzipSync } = await import('fflate');
    const { default: ExcelJS } = await import('exceljs');
    const request = page.request;
    const browser = page.context().browser();
    requireThat(browser, 'BC_BROWSER_REQUIRED');

    async function http(route, { method = 'GET', data, status = 200, mime = 'application/json', context = request } = {}) {
      requireThat(/^\/api\/v1\/[a-zA-Z0-9/?=&%._-]+$/.test(route), 'BC_ROUTE_REJECTED');
      const response = await context.fetch(base + route, { method, ...(data === undefined ? {} : { data }),
        headers: { Origin: base }, timeout: 75000, maxRedirects: 0, maxRetries: 0,
        failOnStatusCode: false });
      try {
        requireThat(response.status() === status && response.url() === base + route, 'BC_HTTP_REJECTED');
        if (status !== 200 && status !== 201) return null;
        const headers = response.headers();
        requireThat(headers['content-type']?.split(';')[0] === mime, 'BC_MIME_REJECTED');
        if (headers['content-length']) requireThat(Number(headers['content-length']) <= MAX, 'BC_BODY_REJECTED');
        const bytes = await response.body();
        requireThat(bytes.length > 0 && bytes.length <= MAX, 'BC_BODY_REJECTED');
        return mime === 'application/json' ? JSON.parse(bytes.toString('utf8')) : { bytes, headers };
      } finally { await response.dispose(); }
    }
    const get = route => http(route);
    const post = (route, data, status = 201) => http(route, { method: 'POST', data, status });
    async function save(name, bytes, mime) {
      requireThat(['offer.docx', 'offer.pdf', 'collection.xlsx', 'export.zip'].includes(name), 'BC_FILE_REJECTED');
      await canonicalDirectory(directory);
      const target = path.join(directory, name);
      requireThat(path.relative(directory, target) === name, 'BC_PATH_REJECTED');
      const handle = await fs.open(target, 'wx', 0o600);
      try {
        const stat = await handle.stat();
        requireThat(stat.isFile() && stat.nlink === 1 && !(await fs.lstat(target)).isSymbolicLink() &&
          (await fs.realpath(target)).toLowerCase() === target.toLowerCase(), 'BC_PATH_REJECTED');
        await handle.writeFile(bytes); await handle.sync();
        requireThat((await handle.stat()).size === bytes.length, 'BC_FILE_REJECTED');
      } finally { await handle.close(); }
      files.push({ path: name, mimeType: mime, bytes: bytes.length, sha256: sha(bytes) });
    }

    stage = 'BC_CLIENT_FAILED';
    const before = await get(`/api/v1/clients/${clientId}`);
    requireThat(before.id === clientId && before.status === 'active' &&
      /^QA SYNTHETIC [a-f0-9-]{36}$/.test(before.displayName), 'BC_SYNTHETIC_CLIENT_REQUIRED');
    pass('BC_SYNTHETIC_CLIENT');
    const marker = `INSTALLED-QA-${randomUUID()}`;
    const address = `${marker} synthetic office`;
    const dueAt = new Date(Date.now() + 3600000).toISOString();

    stage = 'BC_COMMUNICATION_FAILED';
    const communication = await post('/api/v1/communications', { clientId, communicationType: 'call',
      resultCode: 'completed', comment: `${marker} offline call` });
    uuid(communication.id);
    requireThat(communication.taskId === null, 'BC_COMMUNICATION_REJECTED');
    const history = await get(`/api/v1/clients/${clientId}/timeline?kind=communication&eventId=${communication.id}`);
    requireThat(history.items?.some(i => i.id === communication.id && i.kind === 'communication' &&
      i.details === `${marker} offline call`), 'BC_COMMUNICATION_REJECTED');
    pass('BC_COMMUNICATION');

    stage = 'BC_NEED_TASK_FAILED';
    const need = await post('/api/v1/needs', { clientId, operationType: 'rent', propertyType: 'commercial',
      nextAction: { title: `${marker} next call`, dueAt } });
    uuid(need.id); uuid(need.taskId);
    const needCard = await get(`/api/v1/needs/${need.id}`);
    requireThat(needCard.need?.id === need.id && needCard.need.clientId === clientId &&
      needCard.need.status === 'active' && needCard.need.stage === 'new' &&
      needCard.need.operationType === 'rent' && needCard.need.propertyType === 'commercial', 'BC_NEED_REJECTED');
    const task = await get(`/api/v1/tasks/${need.taskId}`);
    requireThat(task.id === need.taskId && task.status === 'planned' && task.dueAt === dueAt &&
      task.title === `${marker} next call` && task.links?.some(l => l.kind === 'need' && l.id === need.id) &&
      task.links.some(l => l.kind === 'client' && l.id === clientId), 'BC_TASK_REJECTED');
    const tasks = await get(`/api/v1/tasks?view=all&status=open&needId=${need.id}&clientId=${clientId}`);
    requireThat(tasks.items?.some(t => t.id === need.taskId && t.status === 'planned'), 'BC_TASK_REJECTED');
    pass('BC_NEED_NEXT_TASK');

    stage = 'BC_PLANNER_FAILED';
    const range = new URLSearchParams({ from: new Date(Date.now() - 86400000).toISOString(),
      to: new Date(Date.now() + 86400000).toISOString(), clientId, type: 'task' });
    const calendar = await get(`/api/v1/calendar?${range}`);
    requireThat(calendar.items?.some(i => i.sourceId === need.taskId && i.type === 'task' &&
      i.status === 'planned' && i.start === dueAt), 'BC_PLANNER_REJECTED');
    pass('BC_PLANNER_TASK');

    stage = 'BC_PROPERTY_COLLECTION_FAILED';
    const property = await post('/api/v1/properties', { propertyType: 'commercial', operationType: 'rent',
      sourceType: 'agency_listing', addressText: address, area: '80', price: '123456.78' });
    uuid(property.id);
    const collection = await post('/api/v1/collections', { name: `${marker} collection` });
    uuid(collection.id);
    const added = await post(`/api/v1/collections/${collection.id}/items`, { items: [{ propertyId: property.id }] }, 200);
    requireThat(added.added === 1, 'BC_COLLECTION_REJECTED');
    let card = await get(`/api/v1/collections/${collection.id}`);
    requireThat(card.id === collection.id && card.visibility === 'private' && card.items?.length === 1 &&
      card.items[0].propertyId === property.id && card.items[0].status === 'in_crm' &&
      card.items[0].property?.addressText === address && String(card.items[0].property.area) === '80' &&
      String(card.items[0].property.price) === '123456.78', 'BC_COLLECTION_REJECTED');
    uuid(card.items[0].id);
    const linked = await post(`/api/v1/collections/${collection.id}/needs`, { expectedUpdatedAt: card.updatedAt, needId: need.id }, 200);
    requireThat(linked.id === collection.id, 'BC_COLLECTION_REJECTED');
    card = await get(`/api/v1/collections/${collection.id}`);
    requireThat(card.needs?.length === 1 && card.needs[0].needId === need.id, 'BC_COLLECTION_REJECTED');
    pass('BC_LOCAL_PROPERTY_COLLECTION');

    stage = 'BC_OFFER_FAILED';
    const offer = await post(`/api/v1/collections/${collection.id}/offer`, { needId: need.id, itemIds: [card.items[0].id] }, 200);
    uuid(offer.id);
    const offerCard = await get(`/api/v1/offers/${offer.id}`);
    const o = offerCard.offer;
    requireThat(o?.id === offer.id && o.clientNeedId === need.id && o.need?.client?.id === clientId &&
      o.status === 'draft' && o.items?.length === 1 && o.items[0].propertyId === property.id &&
      o.items[0].commercialOfferId === offer.id && o.items[0].addressSnapshot === address &&
      String(o.items[0].priceSnapshot) === '123456.78' && String(o.items[0].areaSnapshot) === '80', 'BC_OFFER_REJECTED');
    uuid(o.items[0].id);
    pass('BC_STRUCTURED_OFFER');

    stage = 'BC_DOCX_DOCUMENT_FAILED';
    const document = await post(`/api/v1/offers/${offer.id}/document`, {});
    uuid(document.id);
    const listing = await get(`/api/v1/documents?linkKind=offer&linkId=${offer.id}`);
    const metadata = listing.items?.find(d => d.id === document.id);
    requireThat(metadata?.documentTypeCode === 'commercial_offer' && metadata.mimeType === DOCX &&
      metadata.archivedAt === null, 'BC_DOCUMENT_REJECTED');
    const downloaded = await http(`/api/v1/documents/${document.id}/download`, { mime: DOCX });
    requireThat(downloaded.bytes.length === metadata.fileSize &&
      downloaded.headers['cache-control'] === 'private, no-store' &&
      downloaded.headers['x-content-type-options'] === 'nosniff' &&
      downloaded.headers['content-disposition']?.startsWith('attachment;'), 'BC_DOCUMENT_REJECTED');
    const docx = zipContents(downloaded.bytes, unzipSync);
    requireThat(docx['[Content_Types].xml'] && docx['word/document.xml'] &&
      text(docx['word/document.xml']).includes(address), 'BC_DOCX_REJECTED');
    await save('offer.docx', downloaded.bytes, DOCX);
    const refreshedOffer = await get(`/api/v1/offers/${offer.id}`);
    requireThat(refreshedOffer.offer?.documentLinks?.some(l => l.document.id === document.id), 'BC_DOCUMENT_REJECTED');
    pass('BC_DOCX_PROTECTED_DOCUMENT');

    stage = 'BC_DOCUMENT_DENIAL_FAILED';
    const anonymous = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    try {
      await http(`/api/v1/documents/${document.id}/download`, { context: anonymous.request, status: 401 });
      await http(`/api/v1/documents?linkKind=offer&linkId=${offer.id}`, { context: anonymous.request, status: 401 });
    } finally { await anonymous.close(); }
    const repeated = await http(`/api/v1/documents/${document.id}/download`, { mime: DOCX });
    requireThat(sha(repeated.bytes) === sha(downloaded.bytes), 'BC_DOCUMENT_REJECTED');
    pass('BC_ANONYMOUS_DOCUMENT_DENIED');

    stage = 'BC_PDF_FAILED';
    const pdf = await http(`/api/v1/offers/${offer.id}/pdf`, { mime: 'application/pdf' });
    requireThat(pdf.bytes.length >= 1024 && pdf.bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) &&
      /%%EOF\s*$/.test(pdf.bytes.subarray(-1024).toString('latin1')), 'BC_PDF_REJECTED');
    await save('offer.pdf', pdf.bytes, 'application/pdf');
    pass('BC_REAL_PDF_SIGNATURE');

    stage = 'BC_XLSX_FAILED';
    const xlsx = await http(`/api/v1/collections/${collection.id}/export?format=xlsx`, { mime: XLSX });
    const bookZip = zipContents(xlsx.bytes, unzipSync);
    requireThat(bookZip['[Content_Types].xml'] && bookZip['xl/workbook.xml'] &&
      bookZip['xl/worksheets/sheet1.xml'], 'BC_XLSX_REJECTED');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(xlsx.bytes);
    requireThat(book.worksheets.length === 1 && book.worksheets[0].rowCount === 2 &&
      book.worksheets[0].getCell('B2').value === address &&
      book.worksheets[0].getCell('E2').value === 80 &&
      book.worksheets[0].getCell('F2').value === 123456.78, 'BC_XLSX_REJECTED');
    await save('collection.xlsx', xlsx.bytes, XLSX);
    pass('BC_XLSX_TYPED_CONTENT');

    stage = 'BC_EXPORT_FAILED';
    const exported = await http('/api/v1/export', { mime: 'application/zip' });
    const entries = zipContents(exported.bytes, unzipSync);
    requireThat(entries['manifest.json'] && JSON.parse(text(entries['manifest.json'])), 'BC_EXPORT_REJECTED');
    for (const [name, expected] of [
      ['clients.csv', { id: clientId, displayName: before.displayName }],
      ['communications.csv', { id: communication.id, clientId, communicationType: 'call', resultCode: 'completed', comment: `${marker} offline call` }],
      ['client_needs.csv', { id: need.id, clientId, status: 'active' }],
      ['tasks.csv', { id: need.taskId, title: `${marker} next call`, status: 'planned' }],
      ['properties.csv', { id: property.id, addressText: address, sourceType: 'agency_listing' }],
      ['commercial_offers.csv', { id: offer.id, clientNeedId: need.id, status: 'draft' }],
      ['commercial_offer_items.csv', { id: o.items[0].id, commercialOfferId: offer.id, propertyId: property.id, addressSnapshot: address }],
      ['documents.csv', { id: document.id, checksum: sha(downloaded.bytes) }],
    ]) {
      requireThat(entries[name], 'BC_EXPORT_REJECTED');
      const matching = csvRows(entries[name]).filter(row => row.id === expected.id);
      requireThat(matching.length === 1 && Object.entries(expected).every(([key, value]) =>
        matching[0][key] === value), 'BC_EXPORT_REJECTED');
    }
    await save('export.zip', exported.bytes, 'application/zip');
    pass('BC_EXPORT_ZIP_RELATIONSHIPS');

    stage = 'BC_CLIENT_INTACT_FAILED';
    const after = await get(`/api/v1/clients/${clientId}`);
    for (const key of ['id', 'displayName', 'clientKind', 'status', 'responsibleUserId', 'notes', 'createdAt', 'updatedAt'])
      requireThat(after[key] === before[key], 'BC_CLIENT_CHANGED');
    requireThat(after.needs?.some(n => n.id === need.id && n.status === 'active'), 'BC_CLIENT_CHANGED');
    pass('BC_ORIGINAL_CLIENT_INTACT');
    return { checks, counts: { passed: checks.length, failed: 0, total: checks.length, artifacts: files.length }, files };
  } catch {
    fail(stage);
  }
}

export async function selfTest() {
  const { default: assert } = await import('node:assert/strict');
  assert.equal(validateBase('http://127.0.0.1:12345'), 'http://127.0.0.1:12345');
  for (const value of ['http://localhost:1', 'http://127.0.0.1:0', 'http://127.0.0.1:65536',
    'http://127.0.0.1:80/a', 'http://user@127.0.0.1:80', 'https://127.0.0.1:80']) assert.throws(() => validateBase(value));
  const fixture = path.win32.join(workspace, 'data/qa-v32-installed-browser/run-12345678-1234-4234-8234-123456789012/business-cycle');
  assert.equal(validateDirectory(fixture), fixture);
  for (const value of [fixture + '/x', fixture.replace('business-cycle', '../business-cycle'),
    fixture + ':stream', fixture + '.', fixture.replace('run-', 'other-'), '\\\\server\\share', 'relative'])
    assert.throws(() => validateDirectory(value));
  assert.throws(() => uuid('not-a-uuid'));
  const { zipSync, strToU8, unzipSync } = await import('fflate');
  assert.equal(text(zipContents(Buffer.from(zipSync({ 'a.txt': strToU8('synthetic') })), unzipSync)['a.txt']), 'synthetic');
  assert.throws(() => zipContents(Buffer.from('not zip'), unzipSync));
  assert.throws(() => zipContents(Buffer.from(zipSync({ '../escape': strToU8('synthetic') })), unzipSync));
  assert.deepEqual(csvRows(strToU8('\uFEFFid,comment\r\nx,"a,b\r\nc""d"\r\n')), [{ id: 'x', comment: 'a,b\r\nc"d' }]);
  assert.throws(() => csvRows(strToU8('id,comment\r\nx,"unclosed\r\n')));
  return { code: 'BC_PURE_HELPERS', status: 'PASS' };
}
