import { defineConfig } from 'vitest/config';
import { syntheticConfig } from './shared-config';
export default defineConfig(syntheticConfig('pg'));
