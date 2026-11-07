import { defineConfig } from 'vitest/config';
import base from './vitest.config.mts';
// Inherits only the fresh, explicitly synthetic database harness, never dotenv.
export default defineConfig({ ...base, test: { ...base.test, include: process.env.SYNTHETIC_CONTROL_BACKEND === 'unit' ? ['tests/unit/enterprise-control-fidelity.test.ts', 'tests/unit/enterprise-control-v2.test.ts', 'tests/unit/enterprise-explicit-header.test.ts'] : ['tests/integration/enterprise-control-fidelity.test.ts'] } });
