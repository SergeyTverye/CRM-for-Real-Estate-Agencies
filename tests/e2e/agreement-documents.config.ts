import path from "node:path";
import base from "../../playwright.config";

const root = path.resolve(import.meta.dirname, "../..");
const servers = Array.isArray(base.webServer) ? base.webServer : base.webServer ? [base.webServer] : [];

const config = {
  ...base,
  testDir: path.join(root, "tests/e2e"),
  testMatch: "agreement-documents.spec.ts",
  globalSetup: path.join(root, "tests/e2e/agreement-documents.setup.ts"),
  webServer: servers.map(server => ({ ...server, cwd: root })),
};

export default config;
