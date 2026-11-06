import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { isRuntimeResource, safeCopyTrace, assertRuntimeResources } from "../../scripts/desktop/resource-policy.mjs";
import { runtimeEntries, runtimeBuildOptions } from "../../scripts/desktop/runtime-entries.mjs";
import { build } from "esbuild";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(path.join(process.env.CRM_RESOURCE_QA_ROOT ?? tmpdir(), "resource-policy-"));
  roots.push(root);
  const source = path.join(root, "trace"), output = path.join(root, "app");
  async function put(relative: string, contents = "synthetic") {
    const file = path.join(source, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  return { root, source, output, put };
}

it("copies runtime assets but fails closed for unknown roots, docs and private files", async () => {
  const { source, output, put } = await fixture();
  const allowed = ["server.js", "package.json", ".next-desktop/BUILD_ID", ".next-desktop/required-server-files.json",
    ".next-desktop/server/app/page.js", ".next-desktop/static/chunks/app.js", "public/icon.svg",
    "templates/offer.docx", "import-profiles/example.json", "prisma/sqlite/compatibility.json",
    "prisma/sqlite/migrations/20260101_init/migration.sql", "node_modules/example/README.md", "node_modules/example/LICENSE"];
  const denied = ["unknown-root.json", "unknown-tree/runtime.js", "tz.md", "ТЗ_CRM_v3.md", "AGENTS.md", "CLAUDE.md",
    "docs/architecture.md", "tests/test.js", "scripts/desktop/source.ts", "src/worker.ts", "ops/backup/script.sh",
    ".env.synthetic", "clouds.env", "private-data/synthetic.json", "data/synthetic.json", "backups/synthetic.json",
    "customerdata/synthetic.json", "public/AGENTS.md", "public/customerdata/synthetic.json", "public/synthetic.sqlite",
    "generated/sqlite/client.ts", "prisma/sqlite.config.ts"];
  for (const file of [...allowed, ...denied]) await put(file);
  await safeCopyTrace(source, output);
  await assertRuntimeResources(output);
  for (const file of allowed) expect(await readFile(path.join(output, file), "utf8")).toBe("synthetic");
  for (const file of denied) {
    expect(isRuntimeResource(file)).toBe(false);
    await expect(readFile(path.join(output, file))).rejects.toMatchObject({ code: "ENOENT" });
  }
  expect((await readdir(output)).sort()).toEqual([".next-desktop", "generated", "import-profiles", "node_modules", "package.json", "prisma", "public", "server.js", "templates"].sort());
  await writeFile(path.join(output, "unexpected.json"), "synthetic");
  await expect(assertRuntimeResources(output)).rejects.toThrow("RESOURCE_POLICY_REJECTED:unexpected.json");
});

it("applies destination policy to explicitly copied filesystem dependencies", async () => {
  const { source, output, put } = await fixture();
  await put("example.json"); await put("README.md"); await put("nested/unknown.json");
  await safeCopyTrace(source, output, { prefix: "import-profiles" });
  expect(await readdir(output)).toEqual(["example.json"]);
  expect(isRuntimeResource("prisma/sqlite/migrations/20260101_init/migration.sql")).toBe(true);
});

it("preserves all eight compiled runtime entrypoints without source TypeScript fallbacks", () => {
  expect(runtimeEntries).toEqual({
    "workers/notifications.cjs": "src/worker/notifications-worker.ts",
    "workers/search.cjs": "src/worker/property-search-worker.ts",
    "workers/backup.cjs": "scripts/desktop/runtime/backup-worker.ts",
    "init-db.cjs": "scripts/desktop/init-db.ts",
    "upgrade.cjs": "scripts/desktop/runtime/upgrade.ts",
    "backup-command.cjs": "scripts/desktop/runtime/backup-command.ts",
    "backup-now.cjs": "scripts/desktop/runtime/backup-now.ts",
    "generated/sqlite/client.cjs": "src/generated/prisma-sqlite/client.ts",
  });
  expect(runtimeBuildOptions).toMatchObject({ bundle: true, platform: "node", format: "cjs", packages: "external" });
  for (const [output, input] of Object.entries(runtimeEntries)) {
    expect(isRuntimeResource(output)).toBe(true);
    expect(isRuntimeResource(input)).toBe(false);
  }
});

it("rejects traversal and Windows absolute paths and retains third-party legal notices", () => {
  for (const value of ["../server.js", "public/../../tz.md", "C:\\server.js", "/server.js", "public/x:secret"]) expect(isRuntimeResource(value)).toBe(false);
  for (const value of ["node_modules/example/README.md", "node_modules/example/LICENSE.md", "node_modules/example/NOTICE", "node_modules/example/data/runtime.json", "node/LICENSE", "chromium/chrome/LICENSE.md", "RUNTIMES.md"]) expect(isRuntimeResource(value)).toBe(true);
  expect(isRuntimeResource("node_modules/example/.env.synthetic")).toBe(false);
});

it("bundles all eight real entrypoints in memory with no external source-file dependencies", async () => {
  for (const [output, input] of Object.entries(runtimeEntries)) {
    const result = await build({ ...runtimeBuildOptions, entryPoints: [input], outfile: output, write: false, metafile: true });
    expect(result.outputFiles).toHaveLength(1);
    expect(result.outputFiles[0].contents.byteLength).toBeGreaterThan(0);
    const imports = Object.values(result.metafile!.outputs).flatMap(file => file.imports);
    for (const dependency of imports) {
      expect(dependency.external).toBe(true);
      expect(dependency.path).not.toMatch(/^(?:\.{1,2}[\\/]|[A-Za-z]:[\\/])|\.(?:ts|tsx|mts|cts)$/);
    }
  }
}, 30_000);
