import { execFileSync } from 'node:child_process';
import { readFile, lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { DOMParser } from '@xmldom/xmldom';
import { matchesText } from './fingerprint-core.mjs';

const MAX_FILE = 256 * 1024 * 1024;
const MAX_EXPANDED = 128 * 1024 * 1024;
const MAX_ENTRY = 32 * 1024 * 1024;
const report = (code, name = '.') => console.log(code + ' ' + JSON.stringify(name));
const slash = (name) => name.replaceAll('\\', '/').normalize('NFKC');

function forbidden(name) {
  const normalized = slash(name).toLocaleLowerCase('ru-RU');
  const parts = normalized.split('/');
  const base = parts.at(-1);
  if (base === 'рекламные объекты_работа.xlsx' || base.startsWith('~$')) return true;
  if (parts.includes('private-data') || parts.includes('crm-secrets') || (normalized === 'data/private-imports' || normalized.includes('data/private-imports/'))) return true;
  if (base === 'clouds.env' || /\.crmbackup$/u.test(base)) return true;
  return /\.(dump|sqlite|db)(?:-(?:wal|shm))?$/u.test(base) && !normalized.startsWith('tests/fixtures/synthetic/');
}

let root = process.cwd();
let artifacts = false;
const targets = [];
let failed = false;
const fail = (code, name) => { failed = true; report(code, name); };
try {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) root = path.resolve(args[++i]);
    else if (args[i] === '--staged') {  }
    else if (args[i] === '--artifacts') artifacts = true;
    else if (args[i] === '--artifact' && args[i + 1]) targets.push(args[++i]);
    else { fail('CG_ARGS', 'scripts/security/confidential-guard.mjs'); process.exitCode = 1; throw new Error('ARGS'); }
  }
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { maxBuffer: MAX_FILE, stdio: ['ignore', 'pipe', 'pipe'] });
  root = git('rev-parse', '--show-toplevel').toString('utf8').trim();
  const names = (buffer) => buffer.toString('utf8').split('\0').filter(Boolean);
  const tracked = names(git('ls-files', '-z'));
  const staged = names(git('diff', '--cached', '--name-only', '-z'));
  const blocked = new Set();
  for (const name of new Set([...tracked, ...staged])) {
    if (forbidden(name)) { blocked.add(name); fail('CG_PATH', name); }
  }

  const safePath = async (absolute) => {
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('SCOPE');
    let current = root;
    for (const component of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, component);
      if ((await lstat(current)).isSymbolicLink()) throw new Error('SYMLINK');
    }
  };
  let hashes = new Set();
  const fingerprintFile = path.join(root, 'private-data/fingerprints.json');
  try {
    await safePath(fingerprintFile);
    const stat = await lstat(fingerprintFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ENTRY) throw new Error('FINGERPRINTS');
    const values = JSON.parse(await readFile(fingerprintFile, 'utf8'));
    if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value))) throw new Error('FINGERPRINTS');
    hashes = new Set(values);
    report('CG_FINGERPRINTS', 'private-data/fingerprints.json');
  } catch (error) {
    if (error.code !== 'ENOENT') { fail('CG_FINGERPRINTS_INVALID', 'private-data/fingerprints.json'); }
    else report('CG_NAMES_ONLY');
  }

  const scan = (bytes, name, depth = 0, outer = name) => {
    if (forbidden(name)) { fail('CG_PATH', outer); return; }
    if (!hashes.size) return;
    if (bytes.length > MAX_FILE) { fail('CG_LIMIT', outer); return; }
    const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    if (zip || /\.(xlsx|zip)$/iu.test(name)) {
      if (depth >= 4) { fail('CG_LIMIT', outer); return; }
      try {
        let total = 0;
        let count = 0;
        const entries = unzipSync(bytes, { filter: (entry) => {
          total += entry.originalSize;
          if (++count > 10000 || total > MAX_EXPANDED || entry.originalSize > MAX_ENTRY) throw new Error('LIMIT');
          if (forbidden(entry.name)) { fail('CG_PATH', outer); return false; }
          if (entry.name.split(/[\\/]/u).includes('..') || path.posix.isAbsolute(entry.name)) throw new Error('PATH');
          return true;
        } });
        for (const [entry, content] of Object.entries(entries)) {
          if (entry.endsWith('/')) continue;
          scan(content, 'member' + path.extname(entry), depth + 1, outer);
        }
      } catch { fail('CG_ARCHIVE_INVALID', outer); }
      return;
    }
    const text = Buffer.from(bytes).toString('utf8');
    const xml = /\.xml$/iu.test(name);
    let hit = !xml && matchesText(text, hashes);
    if (!xml && text.includes('\0')) hit ||= matchesText(Buffer.from(bytes).toString('utf16le'), hashes);
    if (xml) {
      try {
        if (/<!DOCTYPE/iu.test(text)) throw new Error('XML_DTD');
        const document = new DOMParser({ onError: () => { throw new Error('XML'); } }).parseFromString(text, 'text/xml');
        for (const tag of ['si', 'is', 'v']) {
          for (const node of Array.from(document.getElementsByTagName(tag))) hit ||= matchesText(node.textContent ?? '', hashes);
        }
        if (!document.getElementsByTagName('si').length && !document.getElementsByTagName('is').length) {
          for (const node of Array.from(document.getElementsByTagName('t'))) hit ||= matchesText(node.textContent ?? '', hashes);
        }
      } catch { fail('CG_XML_INVALID', outer); }
    }
    if (hit) fail('CG_FINGERPRINT', outer);
  };

  const modes = new Map(names(git('ls-files', '--stage', '-z')).map((entry) => {
    const tab = entry.indexOf('\t');
    return [entry.slice(tab + 1), entry.slice(0, 6)];
  }));
  for (const name of names(git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'))) {
    if (blocked.has(name) || !hashes.size) continue;
    if (modes.get(name) !== '100644' && modes.get(name) !== '100755') { fail('CG_FILE_TYPE', name); continue; }
    try {
      const size = Number(git('cat-file', '-s', ':' + name).toString('utf8'));
      if (size > MAX_FILE) fail('CG_LIMIT', name);
      else scan(git('cat-file', 'blob', ':' + name), name);
    }
    catch { fail('CG_READ', name); }
  }

  if (artifacts) targets.push('test-results', 'playwright-report', 'docs', 'src-tauri', 'dist');
  const walk = async (relative, required = false) => {
    const absolute = path.resolve(root, relative);
    const name = slash(path.relative(root, absolute));
    if (name.startsWith('../') || path.isAbsolute(name) || name === '.git' || name.startsWith('.git/')) { fail('CG_SCOPE', name); return; }
    if (forbidden(name)) { fail('CG_PATH', name); return; }
    try {
      await safePath(absolute);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) { fail('CG_FILE_TYPE', name); return; }
      if (stat.isDirectory()) {
        for (const child of await readdir(absolute)) await walk(path.join(name, child), true);
      } else if (!stat.isFile()) fail('CG_FILE_TYPE', name);
      else if (hashes.size) {
        if (stat.size > MAX_FILE) fail('CG_LIMIT', name);
        else scan(await readFile(absolute), name);
      }
    } catch (error) { if (required || error.code !== 'ENOENT') fail('CG_READ', name); }
  };
  for (const target of new Set(targets)) await walk(target, !artifacts || !['test-results', 'playwright-report', 'docs', 'src-tauri', 'dist'].includes(target));
  report(failed ? 'CG_FAIL' : 'CG_PASS');
  if (failed) process.exitCode = 1;
} catch {
  if (!failed) report('CG_ERROR', 'scripts/security/confidential-guard.mjs');
  process.exitCode = 1;
}
