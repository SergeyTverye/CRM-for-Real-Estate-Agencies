import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  normalize as optNormalize,
  sha256 as optSha256,
  cellForms as optCellForms,
  textForms as optTextForms,
  matchesText as optMatchesText,
} from "../../scripts/security/fingerprint-core.mjs";

const refNormalize = (value: unknown) =>
  String(value).normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/\s+/gu, " ").trim();
const refSha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
function refCellForms(value: unknown): Set<string> {
  const text = refNormalize(value);
  const forms = new Set<string>();
  const digits = text.replace(/\D/gu, "");
  if (/^[\d\s.,()+-]+$/u.test(text)) {
    if (digits.length >= 7) forms.add(digits.length === 11 && digits.startsWith("8") ? "7" + digits.slice(1) : digits);
    return forms;
  }
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (text.length >= 10 && (words.length >= 2 || /\d/u.test(text))) forms.add(text);
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(text)) forms.add(text);
  if (/\p{L}/u.test(text) && /(?:\b\d+[\p{L}]?(?:[/-]\d+)?\b)/u.test(text) && /(?:улица|ул\.|проспект|пр-т|переулок|пер\.|шоссе|дом|д\.)/u.test(text)) forms.add(text);
  return forms;
}
function* refTextForms(text: unknown): Generator<string> {
  const emit = function* (candidate: unknown): Generator<string> { yield* refCellForms(candidate); };
  for (const line of String(text).split(/[\r\n]/u)) {
    yield* emit(line);
    for (const cell of line.split(/[\t;|<>`=]/u)) yield* emit(cell);
    for (const quoted of line.matchAll(/"(?:[^"\\]|\\.|"")*"/gu)) {
      try { yield* emit(JSON.parse(quoted[0])); }
      catch { yield* emit(quoted[0].slice(1, -1).replaceAll('""', '"')); }
    }
    const normalized = refNormalize(line);
    const words = [...normalized.matchAll(/[\p{L}\p{N}]+/gu)];
    for (let start = 0; start < words.length; start++) {
      for (let end = start + 1; end < Math.min(words.length, start + 64); end++) {
        const from = words[start]!.index!;
        const to = words[end]!.index! + words[end]![0]!.length;
        if (to - from > 4096) break;
        yield* emit(normalized.slice(from, to));
      }
    }
    for (const match of normalized.matchAll(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu)) yield* emit(match[0]);
    for (const match of normalized.matchAll(/\+?\d[\d ().-]*\d/gu)) yield* emit(match[0]);
    for (const match of normalized.matchAll(/\d{7,}/gu)) yield* emit(match[0]);
  }
}
function refMatchesText(text: unknown, hashes: Set<string>): boolean {
  for (const form of refTextForms(text)) if (hashes.has(refSha256(form))) return true;
  return false;
}

const SECRET = "Синтетический объект Альфа 92387";
const FIXTURES: Array<[string, string]> = [
  ["crlf", "type,value\r\nsynthetic,\"" + SECRET + "\"\r\nsecond\tline"],
  ["russian-case", "ОТЧЁТ содержит: " + SECRET.toUpperCase().replaceAll(" ", "  ") + "."],
  ["combining", "Синтетика é комб ă тест Ё ё Й й " + SECRET],
  ["ligature", "oﬃce ﬁle ﬂow ﬀ тест " + SECRET],
  ["email", "Почта: Synthetic.Person@Example.invalid в тексте " + SECRET],
  ["numbers", "Контакт: 8 999 000 12 34 сумма 54321987 " + SECRET],
  ["html", "<p>пара " + SECRET + "</p> | <a href=\"x\">link</a>"],
  ["json", JSON.stringify({ nested: { value: SECRET } }).replaceAll("С", "С")],
  ["binary-utf8", Buffer.from([0x41, 0x0, 0x42, 0xd0, 0xa1, 0xff, 0x20, ...Buffer.from(SECRET)]).toString("utf8")],
  ["binary-utf16le", Buffer.from("phone: +7 (999) 000-12-34 " + SECRET, "utf16le").toString("utf16le")],
  ["address", "Адрес: ул. Тестовая, д. 17, кв. 5 " + SECRET],
  ["quoted-csv", "a;\"quoted " + SECRET + " value\";b`c=d"],
  ["nbsp-tabs", "Слово1\u00a0\u00a0Слово2\t\tСлово3  " + SECRET],
  ["short-words", "a b c дом ул " + SECRET],
  ["numeric-only", "+7 (999) 000-12-34"],
  ["empty", ""],
];

describe("fingerprint normalization equivalence (synthetic only)", () => {
  it("normalize wrapper stays identical", () => {
    for (const [, text] of FIXTURES) expect(optNormalize(text)).toBe(refNormalize(text));
    expect(optNormalize(54321987)).toBe(refNormalize(54321987));
  });

  it("cellForms branches stay identical", () => {
    for (const [, text] of FIXTURES) {
      expect([...optCellForms(text)].sort()).toEqual([...refCellForms(text)].sort());
    }
    for (const v of [SECRET, "+7 (999) 000-12-34", "8 999 000 12 34", "54321987", "a", "недвижимость", "synthetic.person@example.invalid", "ул. Тестовая, д. 17", 54321987, "  МНОГО   ПРОБЕЛОВ  "]) {
      expect([...optCellForms(v)].sort()).toEqual([...refCellForms(v)].sort());
    }
  });

  it("textForms exact sequence, set, and boolean detection match reference", () => {
    const hashes = new Set([...refCellForms(SECRET)].map((f) => refSha256(f)));
    expect(hashes.size).toBeGreaterThan(0);
    const optHashes = new Set([...optCellForms(SECRET)].map((f) => optSha256(f)));
    expect([...optHashes].sort()).toEqual([...hashes].sort());
    for (const [, text] of FIXTURES) {
      const expected = [...refTextForms(text)];
      const actual = [...optTextForms(text)];
      expect(actual).toEqual(expected); // exact sequence
      expect(new Set(actual)).toEqual(new Set(expected)); // set
      expect(optMatchesText(text, optHashes)).toBe(refMatchesText(text, hashes)); // boolean
    }
    expect(optMatchesText("Недвижимость и продажа: объект готов.", optHashes)).toBe(false);
    expect(refMatchesText("Недвижимость и продажа: объект готов.", hashes)).toBe(false);
  });

  it("~100KB mixed-Unicode synthetic input completes bounded with full consume", () => {
    const chunk =
      "Синтетическая строка Альфа 92387 é ﬁ oﬃce Synthetic.Person@Example.invalid +7 (999) 000-12-34 " +
      "ул. Тестовая, д. 17 <p>html</p> {\"k\":\"v\"}\tcell;part|alt`eq\"quoted, \"x\"\"\r\n" +
      Buffer.from([0x41, 0x0, 0x42, 0xff]).toString("utf8") +
      "  \n";
    const repeats = Math.ceil((100 * 1024) / Buffer.byteLength(chunk, "utf8"));
    const big = chunk.repeat(repeats).slice(0, 110 * 1024);
    expect(Buffer.byteLength(big, "utf8")).toBeGreaterThanOrEqual(100 * 1024);
    const hashes = new Set([...optCellForms(SECRET)].map((f) => optSha256(f)));
    const started = Date.now();
    let count = 0;
    let digest = "";
    for (const form of optTextForms(big)) {
      count++;
      digest = optSha256(form); // force full normalize + hash consume
      if (hashes.has(digest) && count > 0) break; // early boolean path still consumed prefix
    }
    let total = 0;
    for (const form of optTextForms(big)) total += form.length;
    const elapsed = Date.now() - started;
    expect(count).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(0);
    expect(digest.length).toBe(64);
    expect(elapsed).toBeLessThan(10_000);
  });
});
