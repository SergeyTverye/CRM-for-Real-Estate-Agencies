import { cp, lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { runtimeEntries } from './runtime-entries.mjs';

const entrypoints = new Set([...Object.keys(runtimeEntries), 'server.js', 'supervisor.mjs', 'graceful.cjs']);
const rootFiles = new Set(['package.json', 'package-lock.json', 'desktop-manifest.json', 'sbom.cdx.json', 'RUNTIMES.md']);
const privateName = /^(?:\.env(?:\..*)?|clouds\.env|\.git|private-data|private-imports|customerdata)$/i;
const privateFile = /\.(?:db|sqlite|crmbackup|dump)(?:-(?:wal|shm|journal))?$/i;
const developmentFile = /^(?:AGENTS|CLAUDE)(?:\..*)?$|^(?:tz|ТЗ)(?:[_. -].*)?\.md$|\.(?:md|mdx|ts|tsx|mts|cts)$/i;

/** Destination-relative policy: never use repository-wide glob exclusions as a boundary. */
export function isRuntimeResource(relative, directory = false, dist = '.next-desktop') {
  if (!relative) return directory;
  if (path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative)) return false;
  const parts = relative.replaceAll('\\', '/').split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || p.includes(':') || privateName.test(p) || privateFile.test(p))) return false;
  const normalized = parts.join('/');
  // Dependencies own their package layouts, source assets and legal notices.
  // In particular, do NOT strip *.md / LICENSE / README from npm runtime packages.
  if (parts[0] === 'node_modules') return directory || parts.length > 1;
  if (parts.some(p => /^(?:data|backups)$/i.test(p))) return false;
  if (parts.some(p => /^(?:AGENTS|CLAUDE)(?:\..*)?$/i.test(p))) return false;
  // Node/Chromium distributions also carry upstream notices, not app docs.
  if (['node', 'chromium'].includes(parts[0])) return directory || parts.length > 1;
  if (!directory && developmentFile.test(parts.at(-1)) && normalized !== 'RUNTIMES.md') return false;
  if (entrypoints.has(normalized) || rootFiles.has(normalized)) return !directory;
  if (parts[0] === dist) {
    if (parts.length === 1) return directory;
    if (['server', 'static'].includes(parts[1])) return true;
    return !directory && parts.length === 2 && (parts[1] === 'BUILD_ID' || /\.(?:json|js|mjs|cjs)$/.test(parts[1]));
  }
  if (['public', 'templates'].includes(parts[0])) return directory || parts.length > 1;
  if (parts[0] === 'import-profiles') return directory ? parts.length === 1 : parts.length === 2 && /\.json$/.test(parts[1]);
  if (parts[0] === 'prisma') {
    if (parts.length === 1) return directory;
    if (parts[1] !== 'sqlite') return false;
    if (parts.length === 2) return directory;
    if (parts[2] === 'migrations') return directory || /\.(?:sql|toml)$/.test(parts.at(-1));
    return !directory && parts.length === 3 && ['schema.prisma', 'constraints.sql', 'compatibility.json'].includes(parts[2]);
  }
  // Only the bundled client, not generated TypeScript or application sources.
  if (directory && ['workers', 'generated', 'generated/sqlite'].includes(normalized)) return true;
  return false;
}

/** Reject links before cp can dereference them. Denied directories are never traversed. */
export async function safeCopyTrace(from, to, { prefix = '', dist = '.next-desktop' } = {}) {
  await cp(from, to, { recursive: true, dereference: false, filter: async source => {
    const relative = path.relative(from, source).split(path.sep).join('/');
    const target = [prefix, relative].filter(Boolean).join('/');
    const info = await lstat(source);
    if (!isRuntimeResource(target, info.isDirectory(), dist)) return false;
    if (info.isSymbolicLink()) throw Error('RESOURCE_SYMLINK');
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
