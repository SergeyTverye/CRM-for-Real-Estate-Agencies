import { expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { refreshRuntimeAliases, assertRuntimeResources } from "../../scripts/desktop/resource-policy.mjs";

it("refreshes incomplete hashed traces only from packaged production dependencies", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "crm-alias-"));
  const alias = ".next-desktop/node_modules/@prisma/adapter-better-sqlite3-da039dd0f7229020";
  const pkg = "node_modules/@prisma/adapter-better-sqlite3";
  try {
    for (const dir of [alias, pkg + "/dist"]) await mkdir(path.join(root, dir), { recursive: true });
    for (const file of ["dist/index.mjs", "dist/index.js", "LICENSE", "README.md"]) await writeFile(path.join(root, pkg, file), "public-runtime");
    await writeFile(path.join(root, pkg, ".env.synthetic"), "synthetic-denied");
    expect(await refreshRuntimeAliases(root)).toBe(1);
    for (const file of ["dist/index.mjs", "dist/index.js", "LICENSE", "README.md"]) expect(await readFile(path.join(root, alias, file), "utf8")).toBe("public-runtime");
    await expect(readFile(path.join(root, alias, ".env.synthetic"))).rejects.toMatchObject({ code: "ENOENT" });
    // Assert the destination boundary independently of the source install.
    await rm(path.join(root, pkg, ".env.synthetic"));
    await assertRuntimeResources(root);
    await rm(path.join(root, pkg), { recursive: true });
    await mkdir(path.join(root, "outside"));
    await symlink(path.join(root, "outside"), path.join(root, pkg), "junction");
    await expect(refreshRuntimeAliases(root)).rejects.toThrow("RESOURCE_SYMLINK");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("rejects an alias-root junction before copying production files outside the app", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "crm-alias-root-"));
  try {
    await mkdir(path.join(root, "app/node_modules/pkg"), { recursive: true });
    await writeFile(path.join(root, "app/node_modules/pkg/index.js"), "public-runtime");
    await mkdir(path.join(root, "outside/pkg-aaaaaaaaaaaaaaaa"), { recursive: true });
    await mkdir(path.join(root, "app/.next-desktop"), { recursive: true });
    await symlink(path.join(root, "outside"), path.join(root, "app/.next-desktop/node_modules"), "junction");
    await expect(refreshRuntimeAliases(path.join(root, "app"))).rejects.toThrow("RESOURCE_SYMLINK");
    await expect(readFile(path.join(root, "outside/pkg-aaaaaaaaaaaaaaaa/index.js"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
