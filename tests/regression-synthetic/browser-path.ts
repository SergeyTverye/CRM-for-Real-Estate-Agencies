import { chromium } from 'playwright-core';
import { vi } from 'vitest';

const launch = chromium.launch.bind(chromium);
const executablePath = process.env.SCRAPER_CHROME_PATH || chromium.executablePath();
vi.spyOn(chromium, 'launch').mockImplementation(options => launch({ ...options, executablePath }));
vi.spyOn(chromium, 'executablePath').mockReturnValue(executablePath);
