import { defineConfig } from 'vitest/config';
import base from './vitest.config.mts';
export default defineConfig({ ...base, test: { ...base.test, include: process.env.SYNTHETIC_CONTROL_BACKEND === 'unit' ? ['tests/unit/enterprise-export-safety.test.ts'] : ['tests/integration/enterprise-formula-links.test.ts'] } });
