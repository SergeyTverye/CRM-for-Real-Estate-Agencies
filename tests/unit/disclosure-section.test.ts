import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "@playwright/test";
import { build } from "esbuild";

let browser: Browser;
let page: Page;
let javascript: string;
beforeAll(async () => {
  const bundle = await build({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { DisclosureSection } from './src/ui/disclosure-section';
      const root = createRoot(document.getElementById('root'));
      window.draw = (error, defaultOpen = false) => root.render(
        React.createElement(DisclosureSection, {title: 'Параметры', error, defaultOpen},
          React.createElement('input', { 'aria-label': 'Комментарий', defaultValue: 'Начальное значение' })));
      window.draw();
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
  });
  javascript = bundle.outputFiles[0]!.text;
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => { await browser?.close(); });

async function mount() {
  page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: javascript });
  await page.locator('summary').waitFor();
}
async function draw(error?: string, defaultOpen = false) {
  await page.evaluate(({error, defaultOpen}) => {
    (window as unknown as {draw: (error?: string, defaultOpen?: boolean) => void}).draw(error, defaultOpen);
  }, {error, defaultOpen});
}
describe('сворачиваемые параметры формы', () => {
  it('сохраняет значение и тот же узел ввода после сворачивания и повторного рендера', async () => {
    await mount();
    try {
      expect(await page.getByLabel('Комментарий').isVisible()).toBe(false);
      await page.locator('summary').click();
      await page.getByLabel('Комментарий').fill('Уточнить к пятнице');
      const input = await page.getByLabel('Комментарий').elementHandle();
      await page.locator('summary').click();
      await draw();
      expect(await page.getByLabel('Комментарий').isVisible()).toBe(false);
      await page.locator('summary').focus();
      await page.keyboard.press('Enter');
      expect(await page.getByLabel('Комментарий').inputValue()).toBe('Уточнить к пятнице');
      expect(await input!.evaluate(el => el === document.querySelector('input'))).toBe(true);
    } finally { await page.close(); }
  });
  it('раскрывает ошибку сервера и сохраняет введённое значение', async () => {
    await mount();
    try {
      await page.locator('summary').click();
      await page.getByLabel('Комментарий').fill('Сохранить это значение');
      await page.locator('summary').click();
      await draw('Исправьте комментарий');
      await page.getByLabel('Комментарий').waitFor({state: 'visible'});
      expect(await page.getByLabel('Комментарий').inputValue()).toBe('Сохранить это значение');
      expect(await page.locator('summary').innerText()).toContain('Проверьте поля');
      await page.locator('summary').click();
      await draw('Другая ошибка');
      await page.getByLabel('Комментарий').waitFor({state: 'visible'});
    } finally { await page.close(); }
  });
  it('раскрывается при ошибке нативной валидации и поддерживает исходно открытый раздел', async () => {
    await mount();
    try {
      await page.getByLabel('Комментарий').evaluate(el => el.dispatchEvent(new Event('invalid', {bubbles: false})));
      await page.getByLabel('Комментарий').waitFor({state: 'visible'});
      await draw(undefined, true);
      expect(await page.locator('details').getAttribute('open')).not.toBeNull();
    } finally { await page.close(); }
  });
});
