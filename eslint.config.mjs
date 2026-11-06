import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      "src/generated/**",
      ".next/**",
      ".next-*/**",
      "node_modules/**",
      "data/**",
      "backups/**",
      "restore-test/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      ".deploy-test/**",
      "Real-Estate-Scrapper/**",
      "private-data/**",
    ],
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // React-ÃÂºÃÂ¾ÃÂ¼ÃÂ¿ÃÂ¾ÃÂ½ÃÂµÃÂ½Ã‘â€šÃ‘â€¹ ÃÂ½ÃÂµ ÃÂ¾ÃÂ±Ã‘â‚¬ÃÂ°Ã‘â€°ÃÂ°Ã‘Å½Ã‘â€šÃ‘ÂÃ‘Â ÃÂº Prisma ÃÂ½ÃÂ°ÃÂ¿Ã‘â‚¬Ã‘ÂÃÂ¼Ã‘Æ’Ã‘Å½ (ÃÂ¢Ãâ€” 20.1).
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/generated/prisma", "@/generated/prisma/*", "@/shared/db/*"],
              message: "UI/route-Ã‘ÂÃÂ»ÃÂ¾ÃÂ¹ ÃÂ½ÃÂµ Ã‘â‚¬ÃÂ°ÃÂ±ÃÂ¾Ã‘â€šÃÂ°ÃÂµÃ‘â€š Ã‘Â Prisma ÃÂ½ÃÂ°ÃÂ¿Ã‘â‚¬Ã‘ÂÃÂ¼Ã‘Æ’Ã‘Å½ Ã¢â‚¬â€ ÃÂ¸Ã‘ÂÃÂ¿ÃÂ¾ÃÂ»Ã‘Å’ÃÂ·Ã‘Æ’ÃÂ¹Ã‘â€šÃÂµ application-Ã‘ÂÃÂµÃ‘â‚¬ÃÂ²ÃÂ¸Ã‘ÂÃ‘â€¹ ÃÂ¼ÃÂ¾ÃÂ´Ã‘Æ’ÃÂ»ÃÂµÃÂ¹.",
            },
          ],
        },
      ],
    },
  },
  {
    // Data access Ã‘â‚¬ÃÂ°ÃÂ·Ã‘â‚¬ÃÂµÃ‘Ë†Ã‘â€˜ÃÂ½ Ã‘â€šÃÂ¾ÃÂ»Ã‘Å’ÃÂºÃÂ¾ ÃÂ² ÃÂ¼ÃÂ¾ÃÂ´Ã‘Æ’ÃÂ»Ã‘ÂÃ‘â€¦, shared-ÃÂ¸ÃÂ½Ã‘â€žÃ‘â‚¬ÃÂ°Ã‘ÂÃ‘â€šÃ‘â‚¬Ã‘Æ’ÃÂºÃ‘â€šÃ‘Æ’Ã‘â‚¬ÃÂµ, seed, Ã‘â€šÃÂµÃ‘ÂÃ‘â€šÃÂ°Ã‘â€¦ ÃÂ¸ Ã‘ÂÃÂºÃ‘â‚¬ÃÂ¸ÃÂ¿Ã‘â€šÃÂ°Ã‘â€¦.
    files: ["src/modules/**", "src/shared/**", "prisma/**", "tests/**", "scripts/**"],
    rules: { "no-restricted-imports": "off" },
  },
];

export default config;
