import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js App Router использует inline-скрипты для гидратации.
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  ...(process.env.CRM_BUILD_TARGET === "desktop" ? {
    output: "standalone" as const,
    outputFileTracingExcludes: { "/*": ["./.env*", "./private-data/**/*", "./data/**/*", "./backups/**/*"] },
  } : {}),
  devIndicators: false,
  // Отдельный каталог сборки позволяет запускать несколько dev-серверов параллельно (QA/скриншоты).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  // В Docker-сборке проверка типов выполняется отдельно (npm run typecheck в CI/проверке инкремента);
  // повторный запуск tsc внутри next build на сервере с малым объёмом памяти может завершиться OOM.
  typescript: { ignoreBuildErrors: process.env.CRM_DOCKER_BUILD === "1" },
  reactStrictMode: true,
  // pino и argon2 — нативные/серверные пакеты, не бандлим их.
  serverExternalPackages: ["pino", "@node-rs/argon2", "better-sqlite3", "@prisma/adapter-better-sqlite3", "exceljs", "pg", "playwright-core"],
  async headers() {
    // В dev-режиме CSP не применяется: dev-сервер Next.js использует eval и HMR-websocket.
    const headers = process.env.NODE_ENV === "production" ? securityHeaders : securityHeaders.filter((h) => h.key !== "Content-Security-Policy");
    return [{ source: "/:path*", headers }];
  },
};

export default nextConfig;
