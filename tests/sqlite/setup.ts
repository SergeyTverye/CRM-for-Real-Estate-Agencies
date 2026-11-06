import { mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(),"crm-sqlite-core-"));
process.env.DATABASE_URL = "file:" + join(dir,"core.db");
process.env.CRM_DEPLOYMENT_MODE = "desktop";
process.env.CRM_DESKTOP_PORT = "3511";
process.env.FILE_STORAGE_PATH = join(dir,"files");
process.env.AI_ENABLED = "true";
process.env.YANDEX_AI_MAX_MONTHLY_COST_RUB = "1000";
copyFileSync(process.env.SQLITE_TEST_TEMPLATE!,join(dir,"core.db"));
