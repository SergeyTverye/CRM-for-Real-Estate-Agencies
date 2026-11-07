import { writeFileSync } from 'node:fs';

// Never serialize messages, actual/expected, logs, payloads, or raw stacks.
function safeError(error) {
  const locations = [...String(error.stack ?? '').replaceAll('\\', '/').matchAll(/(?:src|tests|scripts)\/[\w./-]+\.(?:ts|tsx|mjs):(\d+):(\d+)/g)].map(m => m[0]);
  const kind = ['AssertionError', 'Error', 'TypeError', 'ConfigError'].includes(error.name) ? error.name : 'TEST_ERROR';
  return { kind, locations: [...new Set(locations)] };
}
export default class SafeReporter {
  onTestRunEnd(modules, errors, reason) {
    const files = modules.map(module => ({
      file: module.relativeModuleId, state: module.state(),
      errors: module.errors().map(safeError),
      tests: [...module.children.allTests()].map((test, index) => ({
        index: index + 1, line: test.location?.line, state: test.result().state,
        durationMs: test.diagnostic()?.duration ?? 0,
        errors: (test.result().errors ?? []).map(safeError),
      })),
    }));
    const counts = { passed: 0, failed: 0, skipped: 0, pending: 0 };
    for (const file of files) for (const test of file.tests) counts[test.state]++;
    writeFileSync(process.env.REGRESSION_RESULTS_PATH, JSON.stringify({ reason, counts, files, unhandledErrors: errors.map(safeError) }, null, 2));
  }
}
