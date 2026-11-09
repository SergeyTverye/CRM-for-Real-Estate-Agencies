// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextEnv = require("@next/env");
require.cache[require.resolve("@next/env")].exports = {
  ...nextEnv,
  loadEnvConfig: () => ({ combinedEnv: process.env, parsedEnv: {}, loadedEnvFiles: [] }),
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextConfig = require("next/dist/server/config");
require.cache[require.resolve("next/dist/server/config")].exports = {
  __esModule: true,
  ...nextConfig,
  default: async (...args) => {
    const config = await nextConfig.default(...args);
    return process.env.BACKUP_UI_TSCONFIG ? { ...config, typescript: { ...config.typescript, tsconfigPath: process.env.BACKUP_UI_TSCONFIG } } : config;
  },
};
