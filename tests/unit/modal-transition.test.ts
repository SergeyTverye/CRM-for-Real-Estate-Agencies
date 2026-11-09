import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";

const source = readFileSync(new URL("../../src/ui/client-kit.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("client-kit.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const modal = ast.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "Modal");
if (!modal) throw new Error("Modal declaration not found");
const compiled = ts.transpileModule(modal.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText;

type ElementProps = Record<string, unknown> & {
  ref?: { current: unknown };
  onClose?: (event: { currentTarget: { open: boolean } }) => void;
  onCancel?: (event: { preventDefault: () => void }) => void;
  onClick?: () => void;
};
type Element = { type: string; props: ElementProps; children: Element[] };

function harness(onClose = vi.fn()) {
  const refs: { current: unknown }[] = [];
  let cursor = 0;
  let effect: () => void = () => {};
  let tree: Element;
  const events: (() => void)[] = [];
  const dialog = {
    open: false,
    showModal: vi.fn(() => { dialog.open = true; }),
    close: vi.fn(() => {
      if (!dialog.open) return;
      dialog.open = false;
      events.push(() => tree.props.onClose!({ currentTarget: dialog }));
    }),
  };
  const exports: { Modal?: (props: Record<string, unknown>) => Element } = {};
  runInNewContext(compiled, {
    exports,
    useRef: (initial: unknown) => {
      const index = cursor++;
      return refs[index] ??= { current: initial };
    },
    useId: () => "modal-title",
    useEffect: (fn: () => void) => { effect = fn; },
    React: { createElement: (type: string, props: ElementProps, ...children: Element[]) => ({ type, props, children }) },
  });
  function render(open: boolean) {
    cursor = 0;
    tree = exports.Modal!({ open, onClose, title: "Synthetic modal", children: null });
    tree.props.ref!.current = dialog;
    effect();
  }
  return {
    dialog, onClose, render,
    replayEffect: () => effect(),
    flush: () => { while (events.length) events.shift()!(); },
    cancel: () => {
      const preventDefault = vi.fn();
      tree.props.onCancel!({ preventDefault });
      expect(preventDefault).toHaveBeenCalledOnce();
    },
    clickX: () => tree.children[0]!.children[1]!.props.onClick!(),
  };
}

it("does not let the list's queued controlled close reset the next modal", () => {
  let active: "list" | "restore" | null = "list";
  const close = vi.fn(() => { active = null; });
  const list = harness(close);
  const restore = harness(close);
  list.render(true);
  restore.render(false);
  active = "restore";
  list.render(false);
  restore.render(true);
  list.flush();
  expect(active).toBe("restore");
  expect(restore.dialog.open).toBe(true);
  expect(close).not.toHaveBeenCalled();
});

it("accounts for multiple controlled closes across rapid reopens and effect replay", () => {
  const h = harness();
  h.render(true);
  h.replayEffect();
  expect(h.dialog.showModal).toHaveBeenCalledOnce();
  h.render(false);
  h.replayEffect();
  expect(h.dialog.close).toHaveBeenCalledOnce();
  h.render(true);
  h.render(false);
  h.render(true);
  h.flush();
  expect(h.dialog.open).toBe(true);
  expect(h.onClose).not.toHaveBeenCalled();
  h.dialog.close();
  h.flush();
  expect(h.onClose).toHaveBeenCalledOnce();
});

it.each(["clickX", "cancel"] as const)("preserves %s dismissal without a second callback", action => {
  const h = harness();
  h.render(true);
  h[action]();
  expect(h.onClose).toHaveBeenCalledOnce();
  h.render(false);
  h.flush();
  expect(h.onClose).toHaveBeenCalledOnce();
});

it("preserves genuine native close callbacks but ignores a stale native close after reopen", () => {
  const h = harness();
  h.render(true);
  h.dialog.close();
  h.flush();
  expect(h.onClose).toHaveBeenCalledOnce();
  h.render(false);
  h.render(true);
  h.dialog.close();
  h.render(false);
  h.render(true);
  h.flush();
  expect(h.dialog.open).toBe(true);
  expect(h.onClose).toHaveBeenCalledOnce();
});
