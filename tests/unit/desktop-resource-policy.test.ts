import { afterEach, expect, it } from "vitest";
import { cp, lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isRuntimeResource, safeCopyTrace, assertRuntimeResources } from "../../scripts/desktop/resource-policy.mjs";
import { runtimeEntries, runtimeBuildOptions } from "../../scripts/desktop/runtime-entries.mjs";
import { build } from "esbuild";
import { checkFinalRuntime } from "../../scripts/desktop/check-final-runtime.mjs";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "resource-policy-")));
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
    ".next-desktop/server/app/page.js", ".next-desktop/static/chunks/app.js",
    "import-profiles/example.json", "prisma/sqlite/compatibility.json",
    ".next-desktop/node_modules/@prisma/client-2c3a283f134fdcb6/runtime/client.js",
    ".next-desktop/node_modules/@prisma/client-2c3a283f134fdcb6/runtime/query_compiler_fast_bg.sqlite.wasm-base64.mjs",
    ".next-desktop/node_modules/@prisma/client-2c3a283f134fdcb6/README.md",
    "prisma/sqlite/migrations/20260101_init/migration.sql", "node_modules/example/README.md", "node_modules/example/LICENSE"];
  const denied = ["unknown-root.json", "unknown-tree/runtime.js", "tz.md", "ТЗ_CRM_v3.md", "AGENTS.md", "CLAUDE.md",
    "docs/architecture.md", "tests/test.js", "scripts/desktop/source.ts", "src/worker.ts", "ops/backup/script.sh",
    ".env.synthetic", "clouds.env", "private-data/synthetic.json", "data/synthetic.json", "backups/synthetic.json",
    "customerdata/synthetic.json", "public/AGENTS.md", "public/customerdata/synthetic.json", "public/synthetic.sqlite",
    "public/icon.svg", "templates/offer.docx", "public/debug.log", "public/secret.txt", "public/src/internal.js",
    "public/ТЗ.txt", "templates/TZ.txt", "templates/debug.log", "templates/secret.txt", "public/synthetic-private.xlsx",
    "templates/examples/client.md", "templates/examples/client.yaml", "templates/examples/collection.docx",
    "templates/examples/collection.xlsx", "templates/synthetic.zip", "public/synthetic.tar.gz",
    "generated/sqlite/client.ts", "prisma/sqlite.config.ts", ".next-desktop/src/client.ts",
    ".next-desktop/docs/guide.md", ".next-desktop/node_modules/example/.env.synthetic"];
  for (const file of [...allowed, ...denied]) await put(file);
  await safeCopyTrace(source, output);
  await assertRuntimeResources(output);
  for (const file of allowed) expect(await readFile(path.join(output, file), "utf8")).toBe("synthetic");
  for (const file of denied) {
    expect(isRuntimeResource(file)).toBe(false);
    await expect(readFile(path.join(output, file))).rejects.toMatchObject({ code: "ENOENT" });
  }
  expect((await readdir(output)).sort()).toEqual([".next-desktop", "generated", "import-profiles", "node_modules", "package.json", "prisma", "server.js"].sort());
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

it("denies unregistered asset roots without traversing their junctions and rejects injected assets", async () => {
  const { root, source, output, put } = await fixture();
  await put("server.js");
  const outside = path.join(root, "synthetic-private");
  await mkdir(outside);
  await writeFile(path.join(outside, "secret.txt"), "synthetic");
  for (const assetRoot of ["public", "templates"]) {
    expect(isRuntimeResource(assetRoot, true)).toBe(false);
    await symlink(outside, path.join(source, assetRoot), "junction");
  }
  await safeCopyTrace(source, output);
  await assertRuntimeResources(output);
  expect(await readdir(output)).toEqual(["server.js"]);
  await mkdir(path.join(output, "public"));
  await writeFile(path.join(output, "public", "secret.txt"), "synthetic");
  await expect(assertRuntimeResources(output)).rejects.toThrow("RESOURCE_POLICY_REJECTED:public");
});

it("materializes only exact Next hashed aliases to packages inside the standalone trace", async () => {
  const { root, source, output, put } = await fixture();
  await put("node_modules/@prisma/client/runtime/client.js");
  const alias = ".next-desktop/node_modules/@prisma/client-2c3a283f134fdcb6";
  await mkdir(path.dirname(path.join(source, alias)), { recursive: true });
  await symlink(path.join(source, "node_modules/@prisma/client"), path.join(source, alias), "junction");
  await safeCopyTrace(source, output);
  await assertRuntimeResources(output);
  expect((await lstat(path.join(output, alias))).isSymbolicLink()).toBe(false);
  expect(await readFile(path.join(output, alias, "runtime/client.js"), "utf8")).toBe("synthetic");
  await rm(path.join(source, alias));
  const outside = path.join(root, "outside");
  await mkdir(outside);
  await symlink(outside, path.join(source, alias), "junction");
  await expect(safeCopyTrace(source, path.join(root, "rejected"))).rejects.toThrow("RESOURCE_SYMLINK");
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
    if (!result.outputFiles?.[0]) throw new Error("RUNTIME_OUTPUT_MISSING");
    expect(result.outputFiles[0].contents.byteLength).toBeGreaterThan(0);
    const imports = Object.values(result.metafile!.outputs).flatMap(file => file.imports);
    for (const dependency of imports) {
      expect(dependency.external).toBe(true);
      expect(dependency.path).not.toMatch(/^(?:\.{1,2}[\\/]|[A-Za-z]:[\\/])|\.(?:ts|tsx|mts|cts)$/);
    }
  }
}, 30_000);

it("runs final-resource preflight from the package with fresh profiles and detects missing runtime fs assets", async () => {
  const { root, source, output, put } = await fixture();
  const alias = path.join(root, "profile-root-alias");
  await symlink(root, alias, "junction");
  await put("init-db.cjs", `const fs=require('node:fs'),p=require('node:path');
    const canonical=value=>{const result=fs.realpathSync.native(value);return process.platform==='win32'?result.toLowerCase():result;};
    if(canonical(process.cwd())!==canonical(__dirname) || process.env.NODE_PATH || process.env.NODE_OPTIONS || process.env.BACKUP_TARGETS) process.exit(2);
    const inside=value=>{const relative=p.relative(canonical(${JSON.stringify(alias)}),canonical(value));return relative!==''&&!p.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+p.sep);};
    if(!inside(process.env.LOCALAPPDATA) || !inside(process.env.APPDATA)) process.exit(3);
    fs.writeFileSync(p.join(process.env.DESKTOP_DATA_DIR,'crm.db'),'synthetic');`);
  await put("server.js", `const http=require('node:http'),fs=require('node:fs'),p=require('node:path');
    require('./.next-desktop/server/probe.cjs');
    const s=http.createServer((q,r)=>{
      if(q.url==='/api/v1/desktop/setup') {r.setHeader('content-type','application/json');r.end(JSON.stringify({available:true}));}
      else if(q.url==='/api/v1/settings/backups/control'||q.url==='/api/v1/operations/backups') {
        const method=q.url==='/api/v1/operations/backups'?'POST':'GET';
        r.statusCode=!fs.existsSync(p.join(__dirname,'.next-desktop/server/app',q.url,'route.js'))?404:q.method!==method?405:q.headers.origin!=='http://127.0.0.1:'+process.env.PORT?403:401;
        r.end('synthetic protected route');
      }
      else if(q.url==='/setup') r.end('<html><script src="/_next/static/app.js"></script></html>');
      else r.end('synthetic');
    }).listen(Number(process.env.PORT),'127.0.0.1');
    process.on('SIGTERM',()=>s.close(()=>process.exit(0)));`);
  await put("graceful.cjs", `process.stdin.on('data',c=>{if(String(c).includes('STOP'))process.emit('SIGTERM');});`);
  await put(".next-desktop/server/probe.cjs", "require('@prisma/client-2c3a283f134fdcb6/runtime/client');");
  await put(".next-desktop/server/app/api/v1/settings/backups/control/route.js", "synthetic protected route");
  await put(".next-desktop/server/app/api/v1/operations/backups/route.js", "synthetic protected route");
  await put(".next-desktop/node_modules/@prisma/client-2c3a283f134fdcb6/runtime/client.js", "module.exports={synthetic:true};");
  await safeCopyTrace(source, output);
  await mkdir(path.join(output, "node"));
  await cp(process.execPath, path.join(output, "node/node.exe"));
  const before = (await readdir(root)).sort();
  await checkFinalRuntime(output, { temporaryRoot: root });
  expect((await readdir(root)).sort()).toEqual(before);
  await checkFinalRuntime(output, { temporaryRoot: alias });
  expect((await readdir(root)).sort()).toEqual(before);
  await checkFinalRuntime(path.toNamespacedPath(path.join(alias, "app")), { temporaryRoot: path.toNamespacedPath(alias) });
  expect((await readdir(root)).sort()).toEqual(before);
  const cli = () => spawnSync(process.execPath, [fileURLToPath(new URL("../../scripts/desktop/check-final-runtime.mjs", import.meta.url)), path.join(alias, "app")], {
    cwd: root, encoding: "utf8", timeout: 20_000,
    env: { NODE_ENV: "test", SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: root, TMP: root, NODE_PATH: "synthetic-forbidden-host-fallback" },
  });
  const passed = cli();
  expect(passed.error).toBeUndefined();
  expect(passed.status).toBe(0);
  expect(passed.stdout.trim().split(/\r?\n/)).toEqual(["INIT_PASS", "READY_PASS", "PRISMA_PASS", "API_ROUTES_PASS", "PAGE_ASSETS_PASS", "PASS"].map(value => `FINAL_RUNTIME_${value}`));
  expect(passed.stderr).toBe("");
  expect((await readdir(root)).sort()).toEqual(before);
  const controlRoute = path.join(output, ".next-desktop/server/app/api/v1/settings/backups/control/route.js");
  await rm(controlRoute);
  await expect(checkFinalRuntime(output, { temporaryRoot: root })).rejects.toThrow("FINAL_RUNTIME_API_ROUTES_FAILED");
  expect((await readdir(root)).sort()).toEqual(before);
  await writeFile(controlRoute, "synthetic protected route");
  await rm(path.join(output, ".next-desktop/node_modules"), { recursive: true });
  await expect(checkFinalRuntime(output, { temporaryRoot: root })).rejects.toThrow("FINAL_RUNTIME_SERVER_EXIT");
  expect((await readdir(root)).sort()).toEqual(before);
  await writeFile(path.join(output, "init-db.cjs"), "console.log('synthetic-secret-stdout');console.error('synthetic-secret-stderr');process.exit(1)");
  await expect(checkFinalRuntime(output, { temporaryRoot: root })).rejects.toThrow("FINAL_RUNTIME_INIT_FAILED_EXIT_1");
  const failed = cli();
  expect(failed.status).toBe(1);
  expect(failed.stdout).toBe("");
  expect(failed.stderr.trim()).toBe("FINAL_RUNTIME_INIT_FAILED_EXIT_1");
  expect((await readdir(root)).sort()).toEqual(before);
  await writeFile(path.join(output, "init-db.cjs"), "console.error('synthetic-secret');console.error('INIT_DATABASE_FAILED_STAGE_LOCATION_CODE_ETIMEDOUT');process.exit(1)");
  const diagnosed = cli();
  expect(diagnosed.status).toBe(1);
  expect(diagnosed.stdout.trim()).toBe("FINAL_RUNTIME_INIT_DATABASE_FAILED_STAGE_LOCATION_CODE_ETIMEDOUT");
  expect(diagnosed.stderr.trim()).toBe("FINAL_RUNTIME_INIT_FAILED_EXIT_1");
  await writeFile(path.join(output, "init-db.cjs"), "console.error('INIT_DATABASE_FAILED_STAGE_LOCATION_CODE_PRIVATE_SECRET');process.exit(1)");
  const untrusted = cli();
  expect(untrusted.stdout).toBe("");
  expect(untrusted.stderr.trim()).toBe("FINAL_RUNTIME_INIT_FAILED_EXIT_1");
  await rm(path.join(output, "node/node.exe"));
  await expect(checkFinalRuntime(output, { temporaryRoot: root })).rejects.toThrow("FINAL_RUNTIME_INIT_FAILED_SPAWN_ENOENT");
  const missing = cli();
  expect(missing.status).toBe(1);
  expect(missing.stdout).toBe("");
  expect(missing.stderr.trim()).toBe("FINAL_RUNTIME_INIT_FAILED_SPAWN_ENOENT");
  expect((await readdir(root)).sort()).toEqual(before);
}, 30_000);
