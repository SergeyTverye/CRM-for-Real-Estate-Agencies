# Архитектура v2.4.1

Срез: 05.11.2026, feature/tz-v2.4.1, история от ba7e6fa. Итоговый SHA: **заполняет координатор**. Модульный монолит: один код приложения и application/domain слой, одна PostgreSQL. Worker уведомлений использует тот же образ, поиск выполняется синхронно в app.

```mermaid
flowchart LR
  U[Браузер] --> APP
  subgraph Docker Compose
    APP[app: Next.js UI и API v1] --> S[Application services]
    S --> P[Domain policies и RBAC]
    P --> DB[(db: PostgreSQL 18)]
    S --> FS[StorageAdapter: data/files]
    W[worker: уведомления] --> S
    M[migrate: миграции и seed] --> DB
    B[backup: одноразовый профиль ops] --> DB
    B --> FS
    B --> BK[backups: dump, файлы, manifest, checksums]
  end
  S --> SC[ScraperAdapter / Chromium]
  SC --> EXT[7 площадок]
  S --> AI[SearchAi / AiGate / ResponsesProvider]
  AI --> Y[Yandex Responses API]
```

Слои: src/app и src/ui → API → modules/*/application → domain/policy → Prisma/StorageAdapter. Серверные страницы получают DTO через application queries. React не импортирует Prisma. Cookie-сессия, Origin, validation и standby guard — в src/server/api-handler.ts; права на связанные сущности проверяются сервисами.

```mermaid
sequenceDiagram
  actor R as Риелтор
  participant N as ClientNeed
  participant S as Property-search
  participant C as ScraperAdapter
  participant A as AiGate / Yandex
  participant D as PostgreSQL
  participant O as CommercialOffer
  R->>N: Открыть доступную потребность
  R->>S: Условия вручную либо русский запрос
  opt Разбор ИИ разрешён
    S->>A: parse без tools, резерв бюджета
    A-->>R: Фильтры или вопрос уточнения
  end
  R->>S: Исправить и подтвердить фильтры
  S->>C: Запрос включённых источников
  C-->>S: Кандидаты и отдельные статусы
  opt Неразрешённые признаки и бюджет
    S->>A: Анализ очищенного публичного описания
    A-->>S: Признаки с цитатами
  end
  opt Полный технический отказ и разрешённый резерв
    S->>D: Атомарно занять webSearchUsed
    S->>A: Отдельный web_search
    A-->>S: URL и кандидаты для повторной проверки
  end
  S->>D: SearchRun, snapshots, criteria, costs
  R->>S: В подборку потребности
  S->>D: SearchSelection без Property и Match
  R->>S: Проверить и явно перенести
  S->>D: Property с происхождением
  R->>S: Отдельно предложить клиенту
  S->>D: NeedPropertyMatch
  R->>O: Сформировать КП из Property
  O->>D: CommercialOfferItem со снимком
```

Бюджет резервируется до платного вызова. ENV ограничивает разрешения UI. Файлы вне public; PostgreSQL содержит метаданные. Backup восстанавливает БД и файлы совместно. Напоминания создаёт только active instance.

Источники: [поиск](../integrations/property-search-application.md), [AI](../integrations/yandex-ai.md), [календарь](../calendar-notifications.md), [Docker/restore](../operations/docker-v241-verification.md), [compose.yaml](../../compose.yaml). Живой сбор семи площадок не подтверждён; smoke проверяет запуск и закрытие Chromium. Полная egress/sandbox-изоляция браузера этим протоколом не подтверждена.
