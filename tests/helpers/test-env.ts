/** Адрес отдельной тестовой БД (compose.test.yaml). Не используйте рабочую БД для тестов. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_test";
