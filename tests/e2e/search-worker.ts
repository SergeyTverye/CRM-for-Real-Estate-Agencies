// Playwright owns this process and stops it with the production web server.
// Use the real queue worker, restricted to the disposable E2E database.
if (new URL(process.env.DATABASE_URL!).pathname !== "/crm_e2e") throw new Error("Requires crm_e2e");
console.log("E2E search worker ready");
void import("../../src/worker/property-search-worker");
