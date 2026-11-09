import { afterEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const picomatch: (patterns: string[], options: { dot: boolean }) => (file: string) => boolean = require("picomatch");
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it("keeps the server deployment output unchanged", async () => {
  vi.stubEnv("CRM_BUILD_TARGET","server");
  const {default:config}=await import("../../next.config");
  expect(config.output).toBeUndefined();
  expect(config.outputFileTracingExcludes).toBeUndefined();
});
it("enables standalone and excludes private input only for explicit desktop target", async () => {
  vi.stubEnv("CRM_BUILD_TARGET","desktop");
  const {default:config}=await import("../../next.config");
  expect(config.output).toBe("standalone");
  expect(config.outputFileTracingExcludes?.["/*"]).toContain("./.env*");
});

it("matches internal desktop trace inputs without excluding dynamic runtime files or upstream layouts", async () => {
  vi.stubEnv("CRM_BUILD_TARGET", "desktop");
  const { default: config } = await import("../../next.config");
  const patterns = config.outputFileTracingExcludes?.["/*"];
  expect(patterns?.length).toBeGreaterThan(4);
  const absolute = (file: string) => path.resolve(file).replaceAll("\\", "/");
  const excluded = picomatch(patterns!.map(absolute), { dot: true });
  const denied = [
    ".env.synthetic", "clouds.env", ".git/config", "private-data/synthetic.xlsx", "private-imports/synthetic.xlsx",
    "customerdata/synthetic.json", "data/synthetic.xlsx", "backups/synthetic.zip", "logs/debug.log",
    "docs/internal.txt", "tests/unit/example.test.ts", "scripts/dev/example.ts", "ops/example.sh",
    "Real-Estate-Scrapper/src/example.js", "vendor/synthetic.tgz", "src/app/api/example/route.ts",
    "src/modules/example/service.ts", "src/shared/example.ts", "src/ui/example.tsx", "src/worker/example.ts",
    "AGENTS.md", "CLAUDE.md", "tz.md", "TZ.txt", "ТЗ.txt", "ТЗ_CRM_v3.txt", "synthetic-private.xlsx",
    "synthetic.zip", "debug.log", "public/debug.log", "templates/debug.log", "coverage/index.html",
    "test-results/synthetic.json", "playwright-report/index.html", "build/example.js", "dist/example.js",
    "src-tauri/target/release/example.exe", "src-tauri/resources/app/server.js",
    ".next-desktop/cache/example.json", ".next-desktop-agent-check/standalone/docs/internal.md",
  ];
  for (const file of denied) expect(excluded(absolute(file)), file).toBe(true);
  const retained = [
    ".next-desktop/server/app/api/v1/settings/backups/control/route.js",
    ".next-desktop/server/app/api/v1/operations/backups/route.js", ".next-desktop/server/app/api/data/route.js",
    ".next-desktop/static/chunks/app.js", ".next-desktop/required-server-files.json",
    ".next-desktop/node_modules/@prisma/client-deadbeefdeadbeef/runtime/client.js",
    "node_modules/example/docs/README.md", "node_modules/example/LICENSE.txt", "node_modules/example/src/index.ts",
    "node_modules/example/dist/index.js", "node_modules/example/data/runtime.json",
    "node_modules/example/archive.zip", "src/generated/prisma-sqlite/client.ts", "generated/sqlite/client.cjs",
    "prisma/sqlite/schema.prisma", "prisma/sqlite/migrations/20260101_init/migration.sql",
    "templates/examples/client.md", "templates/examples/collection.docx", "import-profiles/example.json",
  ];
  for (const file of retained) expect(excluded(absolute(file)), file).toBe(false);
});

it("does not enable desktop tracing for an unset or unrelated build target", async () => {
  for (const target of ["", "preview"]) {
    vi.stubEnv("CRM_BUILD_TARGET", target);
    vi.resetModules();
    const { default: config } = await import("../../next.config");
    expect(config.output).toBeUndefined();
    expect(config.outputFileTracingExcludes).toBeUndefined();
  }
});
