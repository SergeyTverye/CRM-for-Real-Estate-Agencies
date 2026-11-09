import { cp, lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { runtimeEntries } from './runtime-entries.mjs';

const entrypoints = new Set([...Object.keys(runtimeEntries), 'server.js', 'supervisor.mjs', 'graceful.cjs']);
const rootFiles = new Set(['package.json', 'desktop-manifest.json', 'sbom.cdx.json', 'RUNTIMES.md']);
const privateName = /^(?:\.env(?:\..*)?|clouds\.env|\.git|private-data|private-imports|customerdata)$/i;
const privateFile = /\.(?:db|sqlite|crmbackup|dump)(?:-(?:wal|shm|journal))?$/i;
const developmentFile = /^(?:AGENTS|CLAUDE)(?:\..*)?$|^(?:tz|ТЗ)(?:[_. -].*)?\.md$|\.(?:md|mdx|ts|tsx|mts|cts)$/i;
const runtimeAssets = new Set([]);

export function isRuntimeResource(relative, directory = false, dist = '.next-desktop') {
  if (!relative) return directory;
  if (path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative)) return false;
  const parts = relative.replaceAll('\\', '/').split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || p.includes(':') || privateName.test(p) || privateFile.test(p))) return false;
  const normalized = parts.join('/');
  if (parts[0] === 'node_modules') return directory || parts.length > 1;
  if (parts[0] === dist && parts[1] === 'node_modules') return directory || parts.length > 2;
  const compiledNext = parts[0] === dist && ['server', 'static'].includes(parts[1]);
  if (!compiledNext && parts.some(p => /^(?:data|backups)$/i.test(p))) return false;
  if (parts.some(p => /^(?:AGENTS|CLAUDE)(?:\..*)?$/i.test(p))) return false;
  if (['node', 'chromium'].includes(parts[0])) return directory || parts.length > 1;
  if (['public', 'templates'].includes(parts[0])) {
    return directory
      ? [...runtimeAssets].some(asset => asset.startsWith(normalized + '/'))
      : runtimeAssets.has(normalized);
  }
  if (!directory && developmentFile.test(parts.at(-1)) && normalized !== 'RUNTIMES.md') return false;
  if (entrypoints.has(normalized) || rootFiles.has(normalized)) return !directory;
  if (parts[0] === dist) {
    if (parts.length === 1) return directory;
    if (['server', 'static'].includes(parts[1])) return true;
    return !directory && parts.length === 2 && (parts[1] === 'BUILD_ID' || /\.(?:json|js|mjs|cjs)$/.test(parts[1]));
  }
  if (parts[0] === 'import-profiles') return directory ? parts.length === 1 : parts.length === 2 && /\.json$/.test(parts[1]);
  if (parts[0] === 'prisma') {
    if (parts.length === 1) return directory;
    if (parts[1] !== 'sqlite') return false;
    if (parts.length === 2) return directory;
    if (parts[2] === 'migrations') return directory || /\.(?:sql|toml)$/.test(parts.at(-1));
    return !directory && parts.length === 3 && ['schema.prisma', 'constraints.sql', 'compatibility.json'].includes(parts[2]);
  }
  if (directory && ['workers', 'generated', 'generated/sqlite'].includes(normalized)) return true;
  return false;
}

export async function safeCopyTrace(from, to, { prefix = '', dist = '.next-desktop' } = {}) {
  await cp(from, to, { recursive: true, dereference: false, filter: async source => {
    const relative = path.relative(from, source).split(path.sep).join('/');
    const target = [prefix, relative].filter(Boolean).join('/');
    const info = await lstat(source);
    if (!isRuntimeResource(target, info.isDirectory(), dist)) return false;
    if (info.isSymbolicLink()) {
      const alias = target.match(new RegExp('^' + dist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/node_modules/((?:@[^/]+/)?[^/]+)-[a-f0-9]{16}$'));
      if (!prefix && alias) {
        if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(alias[1])) throw Error('RESOURCE_SYMLINK');
        const modules = path.join(from, 'node_modules');
        const expected = path.join(modules, alias[1]);
        let resolved;
        try {
          if ((await lstat(modules)).isSymbolicLink() || (await lstat(expected)).isSymbolicLink()) throw Error('RESOURCE_SYMLINK');
          const moduleRoot = await realpath(modules);
          resolved = await realpath(expected);
          if (!resolved.startsWith(moduleRoot + path.sep)) throw Error('RESOURCE_SYMLINK');
        } catch { throw Error('RESOURCE_SYMLINK'); }
        if (await realpath(source) !== resolved) throw Error('RESOURCE_SYMLINK');
        await safeCopyTrace(expected, path.join(to, relative), { prefix: target, dist });
        return false;
      }
      throw Error('RESOURCE_SYMLINK');
    }
    return true;
  } });
}

export async function assertRuntimeResources(root, dist = '.next-desktop') {
  async function walk(directory, prefix = '') {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const relative = [prefix, item.name].filter(Boolean).join('/');
      if (!isRuntimeResource(relative, item.isDirectory(), dist)) throw Error('RESOURCE_POLICY_REJECTED:' + relative);
      if (item.isSymbolicLink()) throw Error('RESOURCE_SYMLINK');
      if (item.isDirectory()) await walk(path.join(directory, item.name), relative);
    }
  }
  await walk(root);
}

export async function refreshRuntimeAliases(root, dist = '.next-desktop') {
  if ((await lstat(root)).isSymbolicLink()) throw Error('RESOURCE_SYMLINK');
  const rootPath = await realpath(root);
  const modules = path.join(root, 'node_modules');
  if ((await lstat(modules)).isSymbolicLink()) throw Error('RESOURCE_SYMLINK');
  const canonical = await realpath(modules);
  const aliases = path.join(root, dist, 'node_modules');
  for (const directory of [modules, path.join(root, dist), aliases]) {
    if ((await lstat(directory)).isSymbolicLink() || !(await realpath(directory)).startsWith(rootPath + path.sep)) throw Error('RESOURCE_SYMLINK');
  }
  let count = 0;
  async function visit(directory, scope = '') {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw Error('RESOURCE_SYMLINK');
      if (!item.isDirectory()) continue;
      if (!scope && /^@[a-z0-9][a-z0-9._-]*$/i.test(item.name)) {
        await visit(path.join(directory, item.name), item.name + '/');
        continue;
      }
      const match = item.name.match(/^([a-z0-9][a-z0-9._-]*)-[a-f0-9]{16}$/i);
      if (!match) continue;
      const packageName = scope + match[1];
      const source = path.join(modules, packageName);
      if (scope && (await lstat(path.join(modules, scope))).isSymbolicLink()) throw Error('RESOURCE_SYMLINK');
      if ((await lstat(source)).isSymbolicLink()) throw Error('RESOURCE_SYMLINK');
      if (!(await realpath(source)).startsWith(canonical + path.sep)) throw Error('RESOURCE_SYMLINK');
      await safeCopyTrace(source, path.join(directory, item.name), { prefix: dist + '/node_modules/' + scope + item.name, dist });
      count++;
    }
  }
  await visit(aliases);
  return count;
}

function toAbsoluteNormalized(input) {
  if (typeof input !== 'string' || !input || input.includes('\0')) throw Error('RESOURCE_SYMLINK');
  if (!path.isAbsolute(input)) throw Error('RESOURCE_SYMLINK');
  return path.normalize(input);
}

function assertDisjointRoots(sourceAbs, destAbs) {
  const lower = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
  if (lower(sourceAbs) === lower(destAbs)) throw Error('RESOURCE_SYMLINK');
  const fromSource = process.platform === 'win32'
    ? path.relative(lower(sourceAbs), lower(destAbs))
    : path.relative(sourceAbs, destAbs);
  const fromDest = process.platform === 'win32'
    ? path.relative(lower(destAbs), lower(sourceAbs))
    : path.relative(destAbs, sourceAbs);
  const inside = (relative) => relative !== '' && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
  if (inside(fromSource) || inside(fromDest)) throw Error('RESOURCE_SYMLINK');
}

async function assertNoReparseAncestors(absolutePath) {
  let cursor = absolutePath;
  let nearestPath = null;
  let nearestStat = null;
  while (true) {
    try {
      nearestStat = await lstat(cursor);
      nearestPath = cursor;
      break;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw Error('RESOURCE_SYMLINK');
      const parent = path.dirname(cursor);
      if (parent === cursor) throw Error('RESOURCE_SYMLINK');
      cursor = parent;
    }
  }
  if (nearestPath !== absolutePath && !nearestStat.isDirectory()) throw Error('RESOURCE_SYMLINK');
  const chain = [];
  let walk = nearestPath;
  while (true) {
    chain.push(walk);
    const parent = path.dirname(walk);
    if (parent === walk) break;
    walk = parent;
  }
  chain.reverse();
  for (const candidate of chain) {
    let info;
    try {
      info = candidate === nearestPath ? nearestStat : await lstat(candidate);
    } catch {
      throw Error('RESOURCE_SYMLINK');
    }
    if (info.isSymbolicLink()) throw Error('RESOURCE_SYMLINK');
    if (candidate !== nearestPath && !info.isDirectory()) throw Error('RESOURCE_SYMLINK');
  }
}

async function assertSupplementRootsSafe(compiledDir, resourcesDir) {
  const sourceAbs = toAbsoluteNormalized(compiledDir);
  const destAbs = toAbsoluteNormalized(resourcesDir);
  assertDisjointRoots(sourceAbs, destAbs);
  await assertNoReparseAncestors(sourceAbs);
  await assertNoReparseAncestors(destAbs);
}

async function inventoryCompiledServer(directory, dist) {
  const entries = new Map();
  async function visit(current, prefix) {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const relative = prefix ? prefix + '/' + item.name : item.name;
      const full = path.join(current, item.name);
      const info = await lstat(full);
      if (info.isSymbolicLink()) throw Error('RESOURCE_SYMLINK');
      const target = dist + '/server/' + relative;
      if (!isRuntimeResource(target, info.isDirectory(), dist)) throw Error('RESOURCE_POLICY_REJECTED:' + target);
      if (info.isDirectory()) await visit(full, relative);
      else if (info.isFile()) {
        const data = await readFile(full);
        entries.set(relative, createHash('sha256').update(data).digest('hex'));
      } else throw Error('RESOURCE_POLICY_REJECTED:' + target);
    }
  }
  await visit(directory, '');
  return entries;
}

export async function assertCompiledServerComplete(compiledDir, resourcesDir, { dist = '.next-desktop' } = {}) {
  await assertSupplementRootsSafe(compiledDir, resourcesDir);
  let sourceStat;
  try {
    sourceStat = await lstat(compiledDir);
  } catch {
    throw Error('COMPILED_SERVER_MISSING');
  }
  let destStat;
  try {
    destStat = await lstat(resourcesDir);
  } catch {
    throw Error('COMPILED_SERVER_INCOMPLETE');
  }
  if (sourceStat.isSymbolicLink() || destStat.isSymbolicLink()) throw Error('RESOURCE_SYMLINK');
  if (!sourceStat.isDirectory() || !destStat.isDirectory()) throw Error('COMPILED_SERVER_MISSING');
  const source = await inventoryCompiledServer(compiledDir, dist);
  if (!source.size) throw Error('COMPILED_SERVER_MISSING');
  const dest = await inventoryCompiledServer(resourcesDir, dist);
  for (const [relative, hash] of source) {
    if (dest.get(relative) !== hash) throw Error('COMPILED_SERVER_INCOMPLETE');
  }
}

export async function supplementCompiledServer(compiledDir, resourcesDir, { dist = '.next-desktop' } = {}) {
  await assertSupplementRootsSafe(compiledDir, resourcesDir);
  let sourceStat;
  try {
    sourceStat = await lstat(compiledDir);
  } catch {
    throw Error('COMPILED_SERVER_MISSING');
  }
  if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) throw Error('COMPILED_SERVER_MISSING');
  const source = await inventoryCompiledServer(compiledDir, dist);
  if (!source.size) throw Error('COMPILED_SERVER_MISSING');
  await safeCopyTrace(compiledDir, resourcesDir, { prefix: dist + '/server', dist });
  await assertCompiledServerComplete(compiledDir, resourcesDir, { dist });
}
