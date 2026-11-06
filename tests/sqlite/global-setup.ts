import { applySqliteMigrations } from "../../scripts/desktop/database-lifecycle";
export default function setup(project: { config: { env: Record<string, string> } }) {
  const template = project.config.env.SQLITE_TEST_TEMPLATE;
  if (!template) throw new Error("SQLITE_TEST_TEMPLATE_REQUIRED");
  applySqliteMigrations(template);
}
