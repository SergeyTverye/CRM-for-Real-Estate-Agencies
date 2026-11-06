import { build } from 'esbuild';
import { assertRuntimeEntries, runtimeEntries, runtimeBuildOptions } from './runtime-entries.mjs';

assertRuntimeEntries({ tracked: process.env.CI === 'true' });
for (const [output, input] of Object.entries(runtimeEntries)) {
  // No Next build, Prisma generation, native rebuild, resource writes or data access.
  await build({ ...runtimeBuildOptions, entryPoints: [input], write: false });
  console.log('RUNTIME_ENTRY_PASS:' + output);
}
