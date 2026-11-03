# syntax=docker/dockerfile:1.7
# Multi-stage сборка application image (ТЗ 36.3): Debian-based Node.js 24 LTS.
# Один и тот же image используется сервисами `app` (next start) и `migrate`
# (prisma migrate deploy + идемпотентный seed). На хосте Node.js не требуется.

ARG NODE_IMAGE=node:24.22.2-bookworm-slim

# ── 1. Зависимости (воспроизводимо по package-lock.json) ──
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# OpenSSL нужен при установке: по нему Prisma выбирает вариант schema engine (openssl-3.0.x),
# который затем используется миграциями без доступа в Интернет.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ── 2. Сборка ──
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate \
 && ls node_modules/@prisma/engines/ | grep -q 'schema-engine-.*openssl-3' \
 && npx next build \
 && rm -rf .next/cache \
 && npm prune --omit=dev --no-audit --no-fund

# ── 3. Runtime ──
FROM ${NODE_IMAGE} AS runtime
# PostgreSQL 18 client (pg_dump/pg_restore для резервного копирования из раздела «Эксплуатация»),
# zstd/tar для архива файлов, curl для healthcheck, tini как init-процесс.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl curl gnupg zstd tini jq \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-18 \
 && apt-get purge -y gnupg && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ARG APP_VERSION=dev
ARG APP_COMMIT=unknown
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    APP_VERSION=${APP_VERSION} \
    APP_COMMIT=${APP_COMMIT} \
    PATH=/app/node_modules/.bin:$PATH

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json /app/next.config.ts /app/tsconfig.json /app/prisma.config.ts ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/import-profiles ./import-profiles
COPY --from=build --chown=node:node /app/ops/backup/scripts ./ops/backup/scripts

RUN mkdir -p /data/files /data/import-staging /backups && chown -R node:node /data /backups

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node_modules/.bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
