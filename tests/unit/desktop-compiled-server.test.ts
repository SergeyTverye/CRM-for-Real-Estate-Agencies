import { expect, it, afterEach } from "vitest";
import { lstat, mkdtemp, mkdir, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertCompiledServerComplete,
  assertRuntimeResources,
  isRuntimeResource,
  supplementCompiledServer,
} from "../../scripts/desktop/resource-policy.mjs";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const junctionKind = process.platform === "win32" ? "junction" : "dir";

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "compiled-server-")));
  roots.push(root);
  const compiled = path.join(root, "build", "server");
  const dest = path.join(root, "app", ".next-desktop", "server");
  async function put(base: string, relative: string, contents = "synthetic") {
    const file = path.join(base, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  return { root, compiled, dest, put };
}

it("restores a referenced chunk missing from the standalone entry", async () => {
  const { compiled, dest, put } = await fixture();
  const page = "app/(crm)/clients/[id]/page.js";
  const chunk = "chunks/ssr/synthetic-chunk-001.js";
  await put(compiled, page, "require('../" + chunk + "');");
  await put(compiled, chunk, "synthetic chunk");
  await put(dest, page, "require('../" + chunk + "');");
  await expect(assertCompiledServerComplete(compiled, dest)).rejects.toThrow("COMPILED_SERVER_INCOMPLETE");
  await supplementCompiledServer(compiled, dest);
  expect(await readFile(path.join(dest, chunk), "utf8")).toBe("synthetic chunk");
  await assertCompiledServerComplete(compiled, dest);
  expect(isRuntimeResource(".next-desktop/server/" + chunk)).toBe(true);
  await assertRuntimeResources(path.join(dest, "..", ".."));
});

it("refuses unsafe source, missing input and changed bytes fail closed", async () => {
  const { root, compiled, dest, put } = await fixture();
  await expect(supplementCompiledServer(path.join(root, "absent"), dest)).rejects.toThrow("COMPILED_SERVER_MISSING");
  await expect(assertCompiledServerComplete(path.join(root, "absent"), dest)).rejects.toThrow("COMPILED_SERVER_MISSING");

  await put(compiled, "app/page.js", "synthetic");
  await put(compiled, ".env.synthetic", "synthetic");
  await expect(supplementCompiledServer(compiled, dest)).rejects.toThrow("RESOURCE_POLICY_REJECTED");
  await rm(path.join(compiled, ".env.synthetic"));

  const outsideDir = path.join(root, "outside-link");
  await mkdir(outsideDir, { recursive: true });
  await writeFile(path.join(outsideDir, "secret.js"), "synthetic");
  await symlink(outsideDir, path.join(compiled, "linked-dir"), junctionKind);
  await expect(supplementCompiledServer(compiled, dest)).rejects.toThrow("RESOURCE_SYMLINK");
  await rm(path.join(compiled, "linked-dir"), { recursive: true, force: true });

  await supplementCompiledServer(compiled, dest);
  await writeFile(path.join(dest, "app/page.js"), "changed");
  await expect(assertCompiledServerComplete(compiled, dest)).rejects.toThrow("COMPILED_SERVER_INCOMPLETE");
  await expect((async () => {
    await writeFile(path.join(compiled, "app/page.js"), "changed-again");
    await assertCompiledServerComplete(compiled, dest);
  })()).rejects.toThrow("COMPILED_SERVER_INCOMPLETE");
  expect((await lstat(path.join(dest, "app/page.js"))).isSymbolicLink()).toBe(false);
});

it("refuses a destination junction without writing through", async () => {
  const { root, compiled, dest, put } = await fixture();
  const chunk = "chunks/ssr/synthetic-chunk-002.js";
  await put(compiled, "app/page.js", "synthetic");
  await put(compiled, chunk, "synthetic chunk");
  const outside = path.join(root, "outside-dest");
  await mkdir(outside, { recursive: true });
  const control = path.join(outside, "control.txt");
  await writeFile(control, "CONTROL");
  await mkdir(path.dirname(dest), { recursive: true });
  await rm(dest, { recursive: true, force: true });
  await symlink(outside, dest, junctionKind);
  await expect(supplementCompiledServer(compiled, dest)).rejects.toThrow("RESOURCE_SYMLINK");
  await expect(assertCompiledServerComplete(compiled, dest)).rejects.toThrow("RESOURCE_SYMLINK");
  expect(await readFile(control, "utf8")).toBe("CONTROL");
  expect((await readdir(outside)).sort()).toEqual(["control.txt"]);
});

it("refuses a destination ancestor junction for a missing destination", async () => {
  const { root, compiled, dest, put } = await fixture();
  await put(compiled, "app/page.js", "synthetic");
  await put(compiled, "chunks/ssr/synthetic-chunk-003.js", "synthetic chunk");
  const outside = path.join(root, "outside-ancestor");
  await mkdir(outside, { recursive: true });
  const control = path.join(outside, "control.txt");
  await writeFile(control, "CONTROL");
  const ancestor = path.join(root, "app", ".next-desktop");
  await mkdir(path.join(root, "app"), { recursive: true });
  await rm(ancestor, { recursive: true, force: true });
  await symlink(outside, ancestor, junctionKind);
  await expect(supplementCompiledServer(compiled, dest)).rejects.toThrow("RESOURCE_SYMLINK");
  await expect(assertCompiledServerComplete(compiled, dest)).rejects.toThrow("RESOURCE_SYMLINK");
  expect(await readFile(control, "utf8")).toBe("CONTROL");
  expect((await readdir(outside)).sort()).toEqual(["control.txt"]);
});
