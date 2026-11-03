import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      "src/generated/**",
      ".next/**",
      "node_modules/**",
      "data/**",
      "backups/**",
      "restore-test/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      ".deploy-test/**",
    ],
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // React-компоненты не обращаются к Prisma напрямую (ТЗ 20.1).
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/generated/prisma", "@/generated/prisma/*", "@/shared/db/*"],
              message: "UI/route-слой не работает с Prisma напрямую — используйте application-сервисы модулей.",
            },
          ],
        },
      ],
    },
  },
  {
    // Data access разрешён только в модулях, shared-инфраструктуре, seed, тестах и скриптах.
    files: ["src/modules/**", "src/shared/**", "prisma/**", "tests/**", "scripts/**"],
    rules: { "no-restricted-imports": "off" },
  },
];

export default config;
