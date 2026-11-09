import { createHash } from 'node:crypto';

export const normalize = (value) => String(value).normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/\s+/gu, ' ').trim();
export const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

export function cellForms(value) {
  return normalizedCellForms(normalize(value));
}

function normalizedCellForms(text) {
  const forms = new Set();
  const digits = text.replace(/\D/gu, '');
  if (/^[\d\s.,()+-]+$/u.test(text)) {
    if (digits.length >= 7) forms.add(digits.length === 11 && digits.startsWith('8') ? '7' + digits.slice(1) : digits);
    return forms;
  }
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (text.length >= 10 && (words.length >= 2 || /\d/u.test(text))) forms.add(text);
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(text)) forms.add(text);
  if (/\p{L}/u.test(text) && /(?:\b\d+[\p{L}]?(?:[/-]\d+)?\b)/u.test(text) && /(?:улица|ул\.|проспект|пр-т|переулок|пер\.|шоссе|дом|д\.)/u.test(text)) forms.add(text);
  return forms;
}

export function* textForms(text) {
  const emit = function* (candidate) { yield* cellForms(candidate); };
  const emitNormalized = function* (candidate) {
    yield* /^[\x00-\x7f]*$/.test(candidate) ? normalizedCellForms(candidate) : cellForms(candidate);
  };
  for (const line of String(text).split(/[\r\n]/u)) {
    yield* emit(line);
    for (const cell of line.split(/[\t;|<>`=]/u)) yield* emit(cell);
    for (const quoted of line.matchAll(/"(?:[^"\\]|\\.|"")*"/gu)) {
      try { yield* emit(JSON.parse(quoted[0])); }
      catch { yield* emit(quoted[0].slice(1, -1).replaceAll('""', '"')); }
    }
    const normalized = normalize(line);
    const words = [...normalized.matchAll(/[\p{L}\p{N}]+/gu)];
    for (let start = 0; start < words.length; start++) {
      for (let end = start + 1; end < Math.min(words.length, start + 64); end++) {
        const from = words[start].index;
        const to = words[end].index + words[end][0].length;
        if (to - from > 4096) break;
        yield* emitNormalized(normalized.slice(from, to));
      }
    }
    for (const match of normalized.matchAll(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu)) yield* emitNormalized(match[0]);
    for (const match of normalized.matchAll(/\+?\d[\d ().-]*\d/gu)) yield* emitNormalized(match[0]);
    for (const match of normalized.matchAll(/\d{7,}/gu)) yield* emitNormalized(match[0]);
  }
}

export function matchesText(text, hashes) {
  for (const form of textForms(text)) if (hashes.has(sha256(form))) return true;
  return false;
}
