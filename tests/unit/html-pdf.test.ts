import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock("playwright-core", () => ({ chromium: { launch: mocks.launch } }));
vi.mock("@/shared/config/env", () => ({ getConfig: () => ({}) }));
import { htmlToPdf } from "@/modules/export/application/html-pdf";

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it("closes Chromium on timeout and observes a delayed render rejection", async () => {
  vi.useFakeTimers();
  let failRender!: (error: Error) => void;
  const close = vi.fn().mockResolvedValue(undefined);
  mocks.launch.mockResolvedValue({ close, newContext: () => new Promise((_, reject) => { failRender = reject; }) });
  const pending = htmlToPdf("<p>timeout</p>");
  const rejected = expect(pending).rejects.toThrow("Время формирования PDF истекло");
  await vi.advanceTimersByTimeAsync(30_000);
  await rejected;
  expect(close).toHaveBeenCalledTimes(1);
  failRender(new Error("Target closed after timeout"));
  await vi.advanceTimersByTimeAsync(1);
  const pdf = vi.fn().mockResolvedValue(Buffer.from("%PDF-"));
  mocks.launch.mockResolvedValue({ close, newContext: async () => ({ route: vi.fn(), newPage: async () => ({ setDefaultTimeout: vi.fn(), emulateMedia: vi.fn(), setContent: vi.fn(), pdf }) }) });
  await expect(htmlToPdf("<p>next</p>")).resolves.toEqual(Buffer.from("%PDF-"));
});
