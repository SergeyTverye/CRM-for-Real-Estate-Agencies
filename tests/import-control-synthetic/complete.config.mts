import { mergeConfig } from 'vitest/config';
import base from './vitest.config.mts';

const unit = process.env.SYNTHETIC_CONTROL_BACKEND === 'unit';
export default mergeConfig(base, {
    test: {
        include: unit ? ['tests/unit/enterprise*.test.ts', 'tests/unit/private-control-compare.test.ts', 'tests/unit/private-workbook-comparison.test.ts'] : [
            'tests/integration/enterprise-workbook.test.ts',
            'tests/integration/enterprise-export-roundtrip.test.ts',
            'tests/integration/enterprise-control-v2.test.ts',
            'tests/integration/enterprise-control-fidelity.test.ts',
            'tests/integration/enterprise-formula-links.test.ts',
        ],
    },
});
