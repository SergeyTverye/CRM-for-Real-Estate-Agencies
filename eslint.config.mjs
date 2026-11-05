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
      ".deploy-test/**",`n      "Real-Estate-Scrapper/**",
    ],
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // React-ÐºÐ¾Ð¼Ð¿Ð¾Ð½ÐµÐ½Ñ‚Ñ‹ Ð½Ðµ Ð¾Ð±Ñ€Ð°Ñ‰Ð°ÑŽÑ‚ÑÑ Ðº Prisma Ð½Ð°Ð¿Ñ€ÑÐ¼ÑƒÑŽ (Ð¢Ð— 20.1).
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/generated/prisma", "@/generated/prisma/*", "@/shared/db/*"],
              message: "UI/route-ÑÐ»Ð¾Ð¹ Ð½Ðµ Ñ€Ð°Ð±Ð¾Ñ‚Ð°ÐµÑ‚ Ñ Prisma Ð½Ð°Ð¿Ñ€ÑÐ¼ÑƒÑŽ â€” Ð¸ÑÐ¿Ð¾Ð»ÑŒÐ·ÑƒÐ¹Ñ‚Ðµ application-ÑÐµÑ€Ð²Ð¸ÑÑ‹ Ð¼Ð¾Ð´ÑƒÐ»ÐµÐ¹.",
            },
          ],
        },
      ],
    },
  },
  {
    // Data access Ñ€Ð°Ð·Ñ€ÐµÑˆÑ‘Ð½ Ñ‚Ð¾Ð»ÑŒÐºÐ¾ Ð² Ð¼Ð¾Ð´ÑƒÐ»ÑÑ…, shared-Ð¸Ð½Ñ„Ñ€Ð°ÑÑ‚Ñ€ÑƒÐºÑ‚ÑƒÑ€Ðµ, seed, Ñ‚ÐµÑÑ‚Ð°Ñ… Ð¸ ÑÐºÑ€Ð¸Ð¿Ñ‚Ð°Ñ….
    files: ["src/modules/**", "src/shared/**", "prisma/**", "tests/**", "scripts/**"],
    rules: { "no-restricted-imports": "off" },
  },
];

export default config;
