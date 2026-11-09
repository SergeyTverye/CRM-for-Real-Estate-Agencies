#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const CODES = {
  OK: "OK",
  NOT_EXECUTED: "NOT_EXECUTED",
  SELF_TEST_PASS: "SELF_TEST_PASS",
  ARG_ERROR: "ARG_ERROR",
  SOURCE_ERROR: "SOURCE_ERROR",
  EXTRACT_ERROR: "EXTRACT_ERROR",
  BUILD_ERROR: "BUILD_ERROR",
  BROWSER_ERROR: "BROWSER_ERROR",
  SCENARIO_FAIL: "SCENARIO_FAIL",
};

function out(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function fail(code, details) {
  out({ ok: false, code, ...(details ? { details } : {}) });
  process.exitCode = 1;
}

function pass(code, details) {
  out({ ok: true, code, ...(details ? { details } : {}) });
}

function parseArgs(argv) {
  const args = { execute: false, selfTest: false, source: null, chromium: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--execute") args.execute = true;
    else if (a === "--self-test") args.selfTest = true;
    else if (a === "--source") {
      args.source = argv[++i] ?? null;
    } else if (a === "--chromium") {
      args.chromium = argv[++i] ?? null;
    } else if (a === "--help" || a === "-h") {
      args.help = true;
    } else {
      args.unknown = a;
      break;
    }
  }
  return args;
}

function validateExecuteArgs(args) {
  const errs = [];
  if (args.unknown) errs.push("unknown_arg");
  if (!args.source || typeof args.source !== "string") errs.push("missing_source");
  if (!args.chromium || typeof args.chromium !== "string") errs.push("missing_chromium");
  if (args.chromium && !path.isAbsolute(args.chromium)) errs.push("chromium_not_absolute");
  if (args.source) {
    const abs = path.resolve(args.source);
    if (!fs.existsSync(abs)) errs.push("source_not_found");
    else if (!fs.statSync(abs).isFile()) errs.push("source_not_file");
  }
  return errs;
}

export function extractModalSource(tsSource) {
  return import("typescript").then((tsMod) => {
    const ts = tsMod.default ?? tsMod;
    const sf = ts.createSourceFile(
      "client-kit.tsx",
      tsSource,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    let modalText = null;
    const visit = (node) => {
      if (
        ts.isFunctionDeclaration(node) &&
        node.name &&
        node.name.text === "Modal"
      ) {
        const mods = node.modifiers ?? [];
        const exported = mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        if (exported) {
          if (modalText !== null) {
            throw new Error("multiple_exported_Modal_declarations");
          }
          modalText = node.getText(sf);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    if (!modalText) throw new Error("exported_Modal_not_found");
    return modalText;
  });
}

export function buildHarnessBundle(modalText) {
  const harness = `
import React, { useEffect, useId, useRef, useState, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";

${modalText}

const ARCHIVE_UUID = "00000000-0000-4000-8000-000000000001";

function WrappedHarness() {
  const [phase, setPhase] = useState("idle");
  const [selectedArchive] = useState(ARCHIVE_UUID);
  const [listOpen, setListOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [nativeOpen, setNativeOpen] = useState(false);
  const [nativeCloseCount, setNativeCloseCount] = useState(0);
  const [rapidOpen, setRapidOpen] = useState(false);
  const [rapidCloseCount, setRapidCloseCount] = useState(0);
  const [listCloseCount, setListCloseCount] = useState(0);
  const [restoreCloseCount, setRestoreCloseCount] = useState(0);

  const api = {
    getState: () => ({
      phase, selectedArchive, listOpen, restoreOpen, nativeOpen, nativeCloseCount, rapidOpen,
      listCloseCount, restoreCloseCount, rapidCloseCount,
      listDialogOpen: !!document.querySelector('[data-wrap="list"] dialog')?.open,
      restoreDialogOpen: !!document.querySelector('[data-wrap="restore"] dialog')?.open,
      nativeDialogOpen: !!document.querySelector('[data-wrap="native"] dialog')?.open,
      rapidDialogOpen: !!document.querySelector('[data-wrap="rapid"] dialog')?.open,
    }),
    closeRapidControlled: () => setRapidOpen(false),
    reopenRapidControlled: () => {
      flushSync(() => setRapidOpen(false));
      flushSync(() => setRapidOpen(true));
    },
  };
  useEffect(() => { window.__proof = api; }, [phase, selectedArchive, listOpen, restoreOpen, nativeOpen, nativeCloseCount, rapidOpen, listCloseCount, restoreCloseCount, rapidCloseCount]);

  return (
    <StrictMode>
      <div data-testid="archive-value">{selectedArchive}</div>
      <button data-testid="open-list" type="button" onClick={() => { setPhase("list"); setListOpen(true); }}>Open list</button>
      <button data-testid="open-native" type="button" onClick={() => setNativeOpen(true)}>Open native</button>
      <button data-testid="open-rapid" type="button" onClick={() => setRapidOpen(true)}>Open rapid</button>
      <div data-wrap="list">
        <Modal open={listOpen} onClose={() => { setListCloseCount(c => c + 1); setListOpen(false); setPhase("idle"); }} title="List modal">
          <div data-testid="list-body">
            <div data-testid="selected-in-list">{selectedArchive}</div>
            <button data-testid="to-restore" type="button" onClick={() => { setListOpen(false); setRestoreOpen(true); setPhase("restore"); }}>Restore</button>
          </div>
        </Modal>
      </div>
      <div data-wrap="restore">
        <Modal open={restoreOpen} onClose={() => { setRestoreCloseCount(c => c + 1); setRestoreOpen(false); setListOpen(true); setPhase("list"); }} title="Restore modal">
          <div data-testid="restore-body">
            <button data-testid="restore-back" type="button" onClick={() => { setRestoreOpen(false); setListOpen(true); setPhase("list"); }}>Back</button>
          </div>
        </Modal>
      </div>
      <div data-wrap="native">
        <Modal open={nativeOpen} onClose={() => { setNativeCloseCount(c => c + 1); setNativeOpen(false); }} title="Native modal">
          <div data-testid="native-body">native</div>
        </Modal>
      </div>
      <div data-wrap="rapid">
        <Modal open={rapidOpen} onClose={() => { setRapidCloseCount(c => c + 1); setRapidOpen(false); }} title="Rapid modal">
          <div data-testid="rapid-body">rapid</div>
        </Modal>
      </div>
    </StrictMode>
  );
}

const root = createRoot(document.getElementById("root"));
root.render(<WrappedHarness />);
window.__harnessReady = true;
`;
  return import("esbuild").then((esbuildMod) => {
    const esbuild = esbuildMod.default ?? esbuildMod;
    return esbuild.build({
      stdin: {
        contents: harness,
        loader: "tsx",
        resolveDir: process.cwd(),
        sourcefile: "modal-proof-harness.tsx",
      },
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      target: ["chrome120"],
      jsx: "automatic",
      logLevel: "silent",
    });
  }).then((result) => {
    if (!result.outputFiles || !result.outputFiles[0]) throw new Error("esbuild_no_output");
    return result.outputFiles[0].text;
  });
}

function htmlDoc(scriptText) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>modal-proof</title></head>
<body><div id="root"></div>
<script>${scriptText.replace(/<\/script/gi, "<\\/script")}</script>
</body></html>`;
}

async function settle(page, turns = 4) {
  for (let i = 0; i < turns; i++) {
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    }));
  }
}

async function runScenarios(page) {
  const results = {};
  const assertionCodes = new WeakMap();
  const check = (condition, code) => {
    if (!condition) {
      const error = new Error();
      assertionCodes.set(error, code);
      throw error;
    }
  };
  const state = () => page.evaluate(() => window.__proof.getState());
  const events = (kind) => page.evaluate((key) => window.__modalEvents[key] ?? 0, kind);
  const waitClose = async (kind, before) => {
    await page.waitForFunction(({ key, count }) => (window.__modalEvents[key] ?? 0) > count,
      { key: kind, count: before }, { timeout: 3000 });
    await settle(page);
    check(await events(kind) === before + 1, "NATIVE_EVENT_COUNT_MISMATCH");
  };
  const noActiveModal = async () => {
    const st = await state();
    const active = await page.locator('dialog[open], dialog:modal').count();
    return active === 0 && !st.listOpen && !st.restoreOpen && !st.nativeOpen && !st.rapidOpen;
  };
  const cleanup = async () => {
    for (let i = 0; i < 8; i++) {
      await settle(page);
      if (await noActiveModal()) return;
      await page.evaluate(() => {
        const dialogs = [...document.querySelectorAll('dialog[open]')];
        dialogs.at(-1)?.close();
      });
    }
    await settle(page);
    check(await noActiveModal(), "CLEANUP_MODAL_REMAINS");
  };
  const run = async (id, fn) => {
    let errorCode;
    try {
      check(await noActiveModal(), "SCENARIO_START_MODAL_ACTIVE");
      await fn();
    } catch (e) {
      errorCode = assertionCodes.get(e) ?? "SCENARIO_ACTION_FAILED";
    }
    let accounting;
    try {
      accounting = await page.evaluate(() => {
        const st = window.__proof.getState();
        return {
          nativeEvents: Object.fromEntries(["list", "restore", "native", "rapid"].map(
            key => [key, window.__modalEvents[key] ?? 0])),
          callbacks: { list: st.listCloseCount, restore: st.restoreCloseCount,
            native: st.nativeCloseCount, rapid: st.rapidCloseCount },
        };
      });
    } catch {
      errorCode ??= "SCENARIO_ACCOUNTING_FAILED";
    }
    let cleanupCode;
    try {
      await cleanup();
    } catch {
      cleanupCode = "CLEANUP_FAILED";
    }
    results[id] = { ok: !errorCode && !cleanupCode,
      ...(accounting ? { accounting } : {}),
      ...(errorCode ? { error: errorCode } : {}),
      ...(cleanupCode ? { cleanup: cleanupCode } : {}) };
  };

  await page.waitForFunction(() => window.__harnessReady === true && window.__proof, null, { timeout: 5000 });
  page.setDefaultTimeout(3000);
  await page.evaluate(() => {
    window.__modalEvents = {};
    document.addEventListener("close", (event) => {
      const key = event.target.closest('[data-wrap]')?.getAttribute('data-wrap');
      if (key) window.__modalEvents[key] = (window.__modalEvents[key] ?? 0) + 1;
    }, true);
  });
  await settle(page);

  await run("LIST_TO_RESTORE_STAYS_OPEN", async () => {
    await page.getByTestId("open-list").click();
    await settle(page);
    const before = await state();
    check(before.listOpen && before.listDialogOpen, "LIST_NOT_OPEN");
    const count = await events("list");
    await page.getByTestId("to-restore").click();
    await waitClose("list", count);
    const st = await state();
    check(st.restoreOpen && st.restoreDialogOpen, "RESTORE_NOT_OPEN");
    check(!st.listOpen && !st.listDialogOpen, "LIST_STILL_OPEN");
    check(st.phase === "restore", "RESTORE_PARENT_PHASE_CHANGED");
    check(st.listCloseCount === before.listCloseCount, "CONTROLLED_LIST_CALLBACK");
    check(st.restoreCloseCount === before.restoreCloseCount, "UNEXPECTED_RESTORE_CALLBACK");
  });

  await run("ARCHIVE_UUID_RETAINED_STRICT", async () => {
    const uuid = "00000000-0000-4000-8000-000000000001";
    await page.getByTestId("open-list").click();
    await settle(page);
    const listEvents = await events("list");
    await page.getByTestId("to-restore").click();
    await waitClose("list", listEvents);
    const restoreEvents = await events("restore");
    await page.getByTestId("restore-back").click();
    await waitClose("restore", restoreEvents);
    const loc = page.locator('[data-wrap="list"]').getByTestId("selected-in-list");
    await loc.waitFor({ state: "visible", timeout: 3000 });
    check((await state()).selectedArchive === uuid && await loc.textContent() === uuid,
      "ARCHIVE_UUID_CHANGED");
  });

  await run("X_CLOSES_ONCE", async () => {
    await page.getByTestId("open-list").click();
    await settle(page);
    const before = (await state()).listCloseCount;
    const count = await events("list");
    const xBtn = page.locator('[data-wrap="list"] dialog[open]').getByRole("button", { name: "Закрыть" });
    await xBtn.click();
    await waitClose("list", count);
    const st = await state();
    check(!st.listDialogOpen && !st.listOpen, "LIST_STILL_OPEN");
    check(st.listCloseCount - before === 1, "X_CALLBACK_COUNT_MISMATCH");
  });

  await run("ESCAPE_CLOSES_ONCE", async () => {
    await page.getByTestId("open-list").click();
    await settle(page, 4);
    const before = await page.evaluate(() => window.__proof.getState().listCloseCount);
    const count = await events("list");
    const dialog = page.locator('[data-wrap="list"] dialog[open]');
    await dialog.focus();
    await page.keyboard.press("Escape");
    await waitClose("list", count);
    const st = await page.evaluate(() => window.__proof.getState());
    check(!st.listDialogOpen && !st.listOpen, "ESCAPE_LEFT_LIST_OPEN");
    check(st.listCloseCount - before === 1, "ESCAPE_CALLBACK_COUNT_MISMATCH");
  });

  await run("NATIVE_CLOSE_HONORED", async () => {
    await page.getByTestId("open-native").click();
    await settle(page, 4);
    let st = await page.evaluate(() => window.__proof.getState());
    check(st.nativeDialogOpen && st.nativeOpen, "NATIVE_NOT_OPEN");
    const before = st.nativeCloseCount;
    const count = await events("native");
    await page.evaluate(() => {
      const d = document.querySelector('[data-wrap="native"] dialog');
      if (d) d.close();
    });
    await waitClose("native", count);
    st = await page.evaluate(() => window.__proof.getState());
    check(!st.nativeDialogOpen && !st.nativeOpen, "NATIVE_STILL_OPEN");
    check(st.nativeCloseCount - before === 1, "NATIVE_CALLBACK_COUNT_MISMATCH");
  });

  await run("RAPID_CONTROLLED_CLOSE_REOPEN", async () => {
    await page.getByTestId("open-rapid").click();
    await settle(page);
    const before = (await state()).rapidCloseCount;
    for (let i = 0; i < 5; i++) {
      check((await state()).rapidDialogOpen, "RAPID_NOT_OPEN");
      const count = await events("rapid");
      await page.evaluate(() => window.__proof.reopenRapidControlled());
      await waitClose("rapid", count);
      const st = await state();
      check(st.rapidOpen && st.rapidDialogOpen, "RAPID_REOPEN_DISMISSED");
      check(st.rapidCloseCount === before, "RAPID_CONTROLLED_CALLBACK");
    }
    const count = await events("rapid");
    await page.evaluate(() => window.__proof.closeRapidControlled());
    await waitClose("rapid", count);
    const st = await state();
    check(!st.rapidOpen && !st.rapidDialogOpen, "RAPID_FINAL_NOT_CLOSED");
    check(st.rapidCloseCount === before, "RAPID_CONTROLLED_CALLBACK");
  });

  await run("LISTENER_EVENT_ORDERING", async () => {
    await page.getByTestId("open-rapid").click();
    await settle(page);
    const before = (await state()).rapidCloseCount;
    const count = await events("rapid");
    await page.evaluate(() => window.__proof.closeRapidControlled());
    await waitClose("rapid", count);
    let st = await state();
    check(!st.rapidOpen && !st.rapidDialogOpen, "CONTROLLED_CLOSE_LEFT_OPEN");
    check(st.rapidCloseCount === before, "CONTROLLED_CLOSE_CALLED_PARENT");
    await page.getByTestId("open-rapid").click();
    await settle(page);
    check((await state()).rapidDialogOpen, "RAPID_NOT_OPEN");
    const nativeCount = await events("rapid");
    await page.evaluate(() => document.querySelector('[data-wrap="rapid"] dialog').close());
    await waitClose("rapid", nativeCount);
    st = await state();
    check(!st.rapidOpen && !st.rapidDialogOpen, "NATIVE_CLOSE_LEFT_OPEN");
    check(st.rapidCloseCount === before + 1, "LISTENER_NATIVE_CALLBACK_MISMATCH");
  });

  return results;
}

async function execute(args) {
  const errs = validateExecuteArgs(args);
  if (errs.length) return fail(CODES.ARG_ERROR, { errors: errs });

  const sourcePath = path.resolve(args.source);
  let tsSource;
  try {
    tsSource = fs.readFileSync(sourcePath, "utf8");
  } catch {
    return fail(CODES.SOURCE_ERROR, { error: "read_failed" });
  }

  let modalText;
  try {
    modalText = await extractModalSource(tsSource);
  } catch {
    return fail(CODES.EXTRACT_ERROR);
  }

  let bundle;
  try {
    bundle = await buildHarnessBundle(modalText);
  } catch {
    return fail(CODES.BUILD_ERROR);
  }

  let browser;
  try {
    const pw = await import("playwright-core");
    const chromium = pw.chromium ?? (pw.default && pw.default.chromium);
    if (!chromium) throw new Error("chromium_api_missing");
    browser = await chromium.launch({
      executablePath: args.chromium,
      headless: true,
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(htmlDoc(bundle), { waitUntil: "domcontentloaded" });
    const scenarioResults = await runScenarios(page);
    await context.close().catch(() => {});
    const allOk = Object.values(scenarioResults).every((r) => r && r.ok);
    const failed = Object.entries(scenarioResults).filter(([, r]) => !r.ok).map(([k]) => k);
    if (allOk) pass(CODES.OK, { scenarios: Object.keys(scenarioResults), results: scenarioResults });
    else fail(CODES.SCENARIO_FAIL, { failed, scenarios: scenarioResults });
  } catch {
    fail(CODES.BROWSER_ERROR);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

function runSelfTest() {
  const checks = [];
  const ok = (name, cond) => checks.push({ name, ok: !!cond });
  ok("parse_execute", parseArgs(["node", "x", "--execute"]).execute === true);
  ok("parse_self_test", parseArgs(["node", "x", "--self-test"]).selfTest === true);
  ok("parse_source", parseArgs(["node", "x", "--source", "a.tsx"]).source === "a.tsx");
  ok("parse_chromium", parseArgs(["node", "x", "--chromium", "/x/chrome"]).chromium === "/x/chrome");
  ok("reject_relative_chromium", validateExecuteArgs({ execute: true, source: "nope.tsx", chromium: "rel/chrome" }).includes("chromium_not_absolute"));
  ok("reject_missing_source", validateExecuteArgs({ execute: true, source: null, chromium: "C:\\chrome.exe" }).includes("missing_source"));
  ok("reject_missing_chromium", validateExecuteArgs({ execute: true, source: "x", chromium: null }).includes("missing_chromium"));
  const allOk = checks.every((c) => c.ok);
  if (allOk) pass(CODES.SELF_TEST_PASS, { checks });
  else fail(CODES.ARG_ERROR, { checks });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    return pass(CODES.NOT_EXECUTED, { usage: "--execute --source <actual-client-kit.tsx> --chromium <absolute-path> | --self-test" });
  }
  if (args.selfTest) return runSelfTest();
  if (!args.execute) {
    return pass(CODES.NOT_EXECUTED, { reason: "opt_in_required" });
  }
  await execute(args);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch(() => fail(CODES.BROWSER_ERROR));
}
