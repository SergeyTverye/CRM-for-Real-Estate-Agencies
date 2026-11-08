import { beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgreementForm } from "@/ui/domain/agreement-form";
import { emptyAgreement } from "@/ui/domain/deal-form-values";

const state = vi.hoisted(() => ({ index: 0, overrides: new Map<number, unknown>(), warning: vi.fn() }));
vi.mock("react", async importOriginal => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useState: (initial: unknown) => {
    const index = state.index++;
    return react.useState(state.overrides.has(index) ? state.overrides.get(index) : initial);
  } };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));
vi.mock("@/ui/hooks", () => ({
  useUnsavedChangesWarning: state.warning,
  useApiAction: () => ({ pending: false, error: null, run: vi.fn(), fieldError: () => undefined, setError: vi.fn() }),
}));
beforeEach(() => { state.index = 0; state.overrides.clear(); state.warning.mockClear(); });

function render() {
  renderToStaticMarkup(createElement(AgreementForm, {
    mode: "create", initial: emptyAgreement(),
    options: { legalEntities: [], absenceReasons: [], commissionTypes: [], users: [] },
  }));
}
it("does not warn on an untouched agreement", () => {
  render();
  expect(state.warning).toHaveBeenCalledWith(false);
});
it.each([[3, "another-user"], [4, "7"], [4, ""]])("warns when only state %i changes to %s", (index, value) => {
  state.overrides.set(index, value);
  render();
  expect(state.warning).toHaveBeenCalledWith(true);
});
it("stops warning after the changed agreement is saved", () => {
  state.overrides.set(3, "another-user");
  state.overrides.set(4, "7");
  state.overrides.set(8, true);
  render();
  expect(state.warning).toHaveBeenCalledWith(false);
});
