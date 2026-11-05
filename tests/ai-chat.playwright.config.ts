import {defineConfig} from "@playwright/test";
// UI-only fake transport smoke against the already running synthetic demo. No DB reset and no AI dispatch.
process.loadEnvFile(".env");
export default defineConfig({testDir:"./e2e",testMatch:"ai-chat.ui.spec.ts",workers:1,retries:0,timeout:120000,reporter:"list",use:{baseURL:"http://localhost:3411",viewport:{width:1440,height:1000},trace:"off",screenshot:"off"}});
