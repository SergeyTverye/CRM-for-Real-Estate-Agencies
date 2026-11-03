# Соглашения разработки

Краткая памятка для разработчиков и coding-агентов. Нормативные требования — `tz.md`.

## Слои и где что лежит

| Слой | Каталог | Правило |
|---|---|---|
| Presentation (страницы) | `src/app/(crm)/<раздел>/…` | Server components: `requirePageActor()` в каждой странице, данные — через application-сервисы/queries модулей. Без Prisma. |
| Клиентские формы | `src/app/(crm)/<раздел>/*-form.tsx`, `src/ui/**` | `"use client"`, изменения — только через `/api/v1` (`apiCall`, `useApiAction`). |
| API | `src/app/api/v1/**/route.ts` | Тонкие обёртки `api({...}, handler)` из `src/server/api-handler.ts`; ввод — `readJson(req)`, `searchParamsToObject(...)`. |
| Application | `src/modules/<домен>/application/*-service.ts`, `*-queries.ts` | Команды `(actor, input: unknown)` с `parseInput(zodSchema, input)`, транзакции `transaction(tx => …)`, аудит `writeAudit(tx, {actorUserId: actor.userId, …})`. Queries возвращают DTO. |
| Domain / policy | `src/modules/<домен>/domain/*`, `src/modules/access/domain/scopes.ts` | Чистые правила, инварианты, `*Scope(actor)` для where. |
| Shared | `src/shared/*` | Технические примитивы: config, db, errors, validation, codebook, time, logging. Без бизнес-логики. |

ESLint запрещает импорт `@/generated/prisma` и `@/shared/db/*` из `src/app` и `src/ui`.

## Обязательные правила

- **Права — на сервере.** Каждая выборка содержит `…Scope(actor)`; чужая запись → `NotFoundError` (404), функция роли → `ForbiddenError` (403).
- **Валидация входа** — Zod-схемы из `src/shared/validation.ts` (`zRequiredText`, `zOptText`, `zMoney`, `zDateTime`, `zDateOnly`, `zCode('codebook')`…). Деньги — строкой, без float.
- **Optimistic concurrency** — формы редактирования отправляют `expectedUpdatedAt` (ISO из `updatedAt` записи); сервер делает `updateMany({where: {id, updatedAt: expected}})`, при 0 строк — `StaleUpdateError` (409 `STALE_UPDATE`); `FormErrorBanner` показывает кнопку «Обновить данные».
- **ClientNeed:** после любой команды вызывать `assertNeedInvariants(tx, needIds)`; для active нужен next action, для paused — задача возврата, для closed — причина.
- **Справочники:** системные коды — `CODEBOOK` (`labelOf`, `optionsOf`); бизнес-справочники — `loadDictionaries()` + `dictLabel()`/`dictOptions()`; новые значения проверяются `assertDictionaryCode()`.
- **Аудит** — права доступа, ответственный, архив, сделки, комиссии, критические даты (ТЗ 19.1). В before/after не класть секреты.
- **Время** — в БД UTC; на сервере форматировать через `src/server/format.ts` (`fmtDateTime`, `fmtDateOnly`, `fmtMoney`); в клиентских формах — `DateTimeInput` с `timeZone` (передаётся со страницы через `tz()`).
- **Нет физического удаления** основных сущностей из UI — архивирование/статусы.

## UI-набор

- Серверные: `PageHeader`, `Card`, `Badge`, `StatusBadge`, `EmptyState`, `Pagination`, `Tabs` (через `?tab=`), `FilterBar` + `FilterField` + `Select` (GET-форма фильтров), `Dl` — `src/ui/components.tsx`.
- Клиентские: `ActionButton`, `QuickFormButton` (модальная форма по описанию полей), `Modal`, `DateTimeInput`, `SelectInput`, `EntityPicker` (поиск через `/api/v1/clients/pick`, `/api/v1/properties/pick`), `NextActionFields` — `src/ui/client-kit.tsx`; `Field`, `FormErrorBanner`, `SubmitButton` — `src/ui/form.tsx`; `useApiAction`, `useUnsavedChangesWarning` — `src/ui/hooks.ts`.
- Доменные: `TaskList` (+ быстрые «Выполнить/Перенести»), `Timeline`, `DuplicateNotice`, `NewClientFields` — `src/ui/domain/*`.
- Каждый список: серверная пагинация, фильтры, пустое состояние с действием, ошибка фильтров (`loadList`).
- Формы: ошибка поля рядом с полем (`fieldError(name)`), общая — `FormErrorBanner`, предупреждение о несохранённых изменениях.
- Образец раздела: `src/app/(crm)/clients/**`.

## Тесты

- `tests/unit` — чистая логика; `tests/integration` и `tests/authorization` — реальная PostgreSQL (`docker compose -f compose.test.yaml up -d --wait`).
- Фикстуры: `resetDatabase()`, `seedBase()` (manager/realtor1/realtor2 + справочники + ИП/ООО), фабрики `makeClient/makeNeed/makeProperty`, API-тесты через `apiRequest()` + `sessionCookieFor()` + вызов экспортированного `GET/POST` маршрута.
- Запуск: `npx vitest run`, `npx tsc --noEmit`, `npx eslint . --max-warnings=0`.

## Локальный запуск для проверки UI

`npm run dev:webpack` (порт по умолчанию 3000). Dev-режим Turbopack во встроенном браузере Claude может зацикливать перезагрузку — используйте webpack. Тестовые учётные записи dev-БД — в `.env.local` (`SEED_*`).
