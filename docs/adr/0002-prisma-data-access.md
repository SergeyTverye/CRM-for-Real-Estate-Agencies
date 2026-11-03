# ADR-0002. Prisma ORM 7 как data access layer

- **Статус:** принято
- **Решение:** Prisma ORM 7.10 (генератор `prisma-client`, driver adapter `@prisma/adapter-pg`, конфиг `prisma.config.ts`). Prisma Client используется application-слоем модулей напрямую как data access layer; отдельные repository-классы не вводятся (ТЗ: «не создавать абстракции ради архитектурной красоты»). CHECK-ограничения и partial unique indexes — SQL в миграциях. Временные метки — `timestamptz(3)`.
- **Почему timestamptz(3):** optimistic concurrency сравнивает `updated_at` с значением, прочитанным клиентом; JS `Date` имеет миллисекундную точность.
- **Особенность Docker:** schema engine Prisma скачивается при `npm ci`; в образ ставится `openssl`, чтобы выбрать вариант `openssl-3.0.x` — миграции работают без доступа в Интернет.
