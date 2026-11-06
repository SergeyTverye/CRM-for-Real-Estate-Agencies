import { createHash } from 'node:crypto';

export const normalize = (value) => String(value).normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/\s+/gu, ' ').trim();
export const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

export function cellForms(value) {
  const text = normalize(value);
  const forms = new Set();
  if (typeof value === 'string' && text.length >= 4) forms.add(text);
  const digits = text.replace(/\D/gu, '');
  if (/^[\d\s.,()+-]+$/u.test(text) && digits.length >= 5) {
    forms.add(text);
    forms.add(digits);
    if (digits.length === 11 && digits.startsWith('8')) forms.add('7' + digits.slice(1));
  }
  return forms;
}

// The producer and scanner share normalization. No plaintext dictionary.
export function matchesText(text, hashes) {
  const normalized = normalize(text);
  const matches = (candidate) => [...cellForms(candidate)].some((form) => hashes.has(sha256(form)));
  if (matches(normalized)) return true;
  for (const line of normalized.split(/[\r\n\t<>"`=;|]/u)) if (matches(line)) return true;
  const words = [...normalized.matchAll(/[\p{L}\p{N}]+/gu)];
  for (let start = 0; start < words.length; start++) {
    for (let end = start; end < Math.min(words.length, start + 64); end++) {
      const from = words[start].index;
      const to = words[end].index + words[end][0].length;
      if (to - from > 4096) break;
      if (matches(normalized.slice(from, to))) return true;
    }
  }
  for (const number of normalized.matchAll(/\+?\d[\d ().-]{3,}\d/gu)) if (matches(number[0])) return true;
  return false;
}
