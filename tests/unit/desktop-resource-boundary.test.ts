import { afterEach, expect, it } from "vitest";
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { isRuntimeResource, safeCopyTrace } from "../../scripts/desktop/resource-policy.mjs";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(prefix = "desktop-boundary-") {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  roots.push(root);
  const source = path.join(root, "trace");
  const output = path.join(root, "app");
  async function put(relative: string, contents = "synthetic") {
    const file = path.join(source, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  return { root, source, output, put };
}

it("retains compiled Next runtime API routes under .next-desktop while denying root data/backups artifacts", async () => {
  const retained = [
    ".next-desktop/server/app/api/v1/settings/backups/control/route.js",
    ".next-desktop/server/app/api/data/route.js",
  ];
  const denied = [
    "data/backups/synthetic.cron",
    "data/backups/private/synthetic.manifest",
    "backups/synthetic.cron",
  ];

  for (const file of retained) {
    expect(isRuntimeResource(file), `expected runtime resource to be retained: ${file}`).toBe(true);
  }
  for (const file of denied) {
    expect(isRuntimeResource(file), `expected private artifact to be denied: ${file}`).toBe(false);
  }

  const { source, output, put } = await fixture();
  for (const file of [...retained, ...denied]) await put(file);
  await safeCopyTrace(source, output);

  for (const file of retained) {
    expect(await readFile(path.join(output, file), "utf8")).toBe("synthetic");
  }
  for (const file of denied) {
    await expect(readFile(path.join(output, file))).rejects.toMatchObject({ code: "ENOENT" });
  }
});

it("rejects hashed-alias junction whose captured name resolves expected root outside node_modules", async () => {
  const { root, source, put } = await fixture("desktop-boundary-dotdot-");
  // Minimal legitimate package so trace shape is realistic; the malicious alias must not copy trace root.
  await put("node_modules/real-pkg/index.js", "real");
  await put("AGENTS.md", "synthetic internal instructions");
  await mkdir(path.join(source, ".next-desktop", "server"), { recursive: true });
  await writeFile(path.join(source, ".next-desktop", "server", "page.js"), "page");

  const alias = ".next-desktop/node_modules/..-aaaaaaaaaaaaaaaa";
  await mkdir(path.dirname(path.join(source, alias)), { recursive: true });
  // Junction/link target is the trace root itself: if accepted, expected=trace/node_modules/.. resolves to trace root
  // and safeCopyTrace would copy app source as a dependency.
  await symlink(source, path.join(source, alias), "junction");

  const rejected = path.join(root, "rejected-dotdot");
  await expect(safeCopyTrace(source, rejected)).rejects.toThrow("RESOURCE_SYMLINK");
  await expect(readFile(path.join(rejected, alias, "AGENTS.md"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("materializes legitimate scoped package aliases and rejects invalid package scopes", async () => {
  const { source, output, put } = await fixture("desktop-boundary-scope-");
  await put("node_modules/@scope/pkg/runtime/client.js", "pkg");
  await put("node_modules/@scope/pkg/package.json", '{"name":"@scope/pkg"}');
  await put("node_modules/@scope/pkg/data/runtime.json", "runtime data");

  const legit = ".next-desktop/node_modules/@scope/pkg-deadbeefdeadbeef";
  await mkdir(path.dirname(path.join(source, legit)), { recursive: true });
  await symlink(path.join(source, "node_modules/@scope/pkg"), path.join(source, legit), "junction");

  await safeCopyTrace(source, output);
  expect((await lstat(path.join(output, legit))).isSymbolicLink()).toBe(false);
  expect(await readFile(path.join(output, legit, "runtime/client.js"), "utf8")).toBe("pkg");
  expect(await readFile(path.join(output, legit, "data/runtime.json"), "utf8")).toBe("runtime data");

  // Invalid npm scope must be refused before attempting filesystem resolution.
  const { root: root2, source: source2, put: put2 } = await fixture("desktop-boundary-scope-escape-");
  await put2("node_modules/@scope/pkg/index.js", "pkg");
  const outside = path.join(root2, "outside-target");
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(outside, "secret.txt"), "nope");
  const evil = ".next-desktop/node_modules/@../evil-deadbeefdeadbeef";
  await mkdir(path.dirname(path.join(source2, evil)), { recursive: true });
  await symlink(outside, path.join(source2, evil), "junction");

  await expect(safeCopyTrace(source2, path.join(root2, "rejected-scope"))).rejects.toThrow("RESOURCE_SYMLINK");
});

it("rejects an otherwise valid alias behind a scoped ancestor junction outside the trace", async () => {
  const { root, source, output, put } = await fixture("desktop-boundary-ancestor-");
  await put("node_modules/root-pkg/index.js", "synthetic package");
  const outside = path.join(root, "outside", "pkg");
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(outside, "index.js"), "synthetic outside file");
  await symlink(path.dirname(outside), path.join(source, "node_modules", "@escape"), "junction");
  const alias = path.join(source, ".next-desktop", "node_modules", "@escape", "pkg-deadbeefdeadbeef");
  await mkdir(path.dirname(alias), { recursive: true });
  await symlink(outside, alias, "junction");
  await expect(safeCopyTrace(source, output)).rejects.toThrow("RESOURCE_SYMLINK");
});
