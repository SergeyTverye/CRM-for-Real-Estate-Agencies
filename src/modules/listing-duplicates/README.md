# Межплощадочные дубли — SR-07 / AT-07

## Контракт серверному агенту поиска

```ts
import { regroupForListings, getGroupsForListings } from "@/modules/listing-duplicates";

// После commit сохранения ExternalListing и snapshots, вне внешней транзакции:
const { groupIds } = await regroupForListings(persistedListingIds);
// После проверки доступа actor к SearchRun; listingIds — UUID текущей страницы выдачи:
const duplicateGroups = await getGroupsForListings(actor, pageListingIds);
```

- `regroupForListings(listingIds: string[]): Promise<{groupIds: string[]}>`: внутренний ingestion hook, без actor; 1–500 UUID, повторы удаляются. Отсутствующие записи пропускаются. Не создавать HTTP endpoint без аутентификации для этого hook. Для пустого batch hook не вызывать.
- Сравнивает сохранённые записи тех же города/операции, включая другие запуски и источники. Явный потолок 5000 кандидатов: при превышении `VALIDATION_ERROR`, без частичной записи. Большая область требует следующего инкремента адресных индексов/пакетного планировщика; это не скрытая выборка первых 5000.
- `getGroupsForListings(actor, listingIds): Promise<DuplicateGroupDto[]>`: 0–500 UUID; пустой вход → `[]`; обе роли сотрудников. Отдаёт активные группы, пересекающиеся с переданными объявлениями, **со всеми объявлениями группы**, в том числе находящимися за пределами страницы. Исключённые объявления помечены `releasedAt`; они не являются активными членами.
- В DTO даты ISO, деньги строками, единицы канонические `rub_*` (DB `total/per_month/...` преобразуются); неизвестная единица → null. У цены каждого исторического снимка своя единица; отсутствующая единица не подменяется текущей.
- Не возвращаются seller name/phone/email, description, snapshot.normalized, данные собственников/клиентов, методы проверки собственника. Seller — allowlist `owner/agent/unknown`; URL без query/hash/credentials. Доступ к SearchRun проверяет вызывающий сервис: внешний каталог объявлений общий для сотрудников.
- Общая PostgreSQL transaction advisory lock 310007 сериализует regroup и решения. Транзакция охватывает группы/членство/аудит. При ошибке hook сохранить результаты поиска и показать отдельную ошибку дедупликации; не удалять уже принятые объявления.
- Автоматически не создаются Property, NeedPropertyMatch, клиент, перенос в каталог или merge. Точные identity уже защищены уникальностью ExternalListing.

## Контракт агенту UI поиска

```tsx
import { ListingDuplicateGroups } from "@/ui/listing-duplicates";
<ListingDuplicateGroups groups={duplicateGroups} loading={loading} error={errorMessage}
  onChanged={() => refreshSearchResults()} />
```

`ListingDuplicateGroupCard` доступна отдельно. UI содержит таблицу источников, историю цен, доступность, тип продавца, доказательства/баллы, журнал решений и диалог подтверждения. Идентификаторы используются только в запросах/key, в интерфейсе не выводятся. Компонент интегрирует существующие Modal/FormErrorBanner/useApiAction, конфликт → обновление группы, pending, ошибки/403, toast успеха, предупреждение beforeunload для заполненного диалога. Подключение к экрану `/property-search` оставлено агенту UI по распределению зон.

## API

- `GET /api/v1/listing-duplicates?listingIds=<uuid,uuid>` → `{groups: DuplicateGroupDto[]}`.
- `GET /api/v1/listing-duplicates/{id}` → `DuplicateGroupDto` (включая историю отклонённой группы).
- `POST .../{id}/decisions`: `{decision: "confirm"|"different"|"defer"|"split", expectedUpdatedAt: ISO, confirmed: true, listingId?: UUID, comment?: string}` → обновлённый DTO. listingId обязателен только для split. Версия обязательна, конфликт 409 STALE_UPDATE. Требует активной сессии, отсутствия требования смены временного пароля, same-origin, active instance.
- `POST .../{id}/explanation`: `{confirmedPaid:true,expectedUpdatedAt:ISO}` → проверенные AI evidence, `humanConfirmationRequired:true`, версия и флаг усечения. Только probable/deferred и не менее одной пары. По кнопке, без автоматических запросов/повторов; результат не изменяет группу.

## Правила и решения

Адрес: регистр/ё→е, город, ул./улица, пр-т/проспект, дом, корпус, строение, помещение/офис. Разные известные дом/корпус/строение/помещение, этаж/тип этажа, город/улица, операция и несовместимое назначение запрещают кандидата. Площадь: `abs(a-b) <= max(2 м², 3% max(a,b))`. Признаки и различия фиксируются отдельно; отсутствующее значение = unknown, а не совпадение.

Адрес+площадь при неизвестном этаже/помещении: probable, 35/100, никогда auto_exact/confirmed. При пропущенном доме дополнительно обязательны одинаковые точные площадь, этаж, назначение и цена с известной совместимой единицей: также только 35/100. Цена сама по себе недостаточна. Дополнительные структурированные признаки читаются по allowlist из последнего snapshot (только boolean/number, без произвольных строк). Группы complete-link: все пары должны быть совместимы, транзитивная цепочка не обходит противоречие.

`different` → rejected, memberships освобождает существующий DB trigger; историческая отрицательная пара навсегда исключена из автоматической группировки. `split` → releasedAt, ListingDuplicateDecision.comment содержит JSON `{listingId,comment}`, аудит содержит listingId; исключённый участник не возвращается к прежним участникам. Решения только добавляются, история не удаляется. `confirm/defer` замораживают состав; после любого человеческого решения состав автоматически не расширяется. Непроверенные probable-группы могут получать новых совместимых участников. Ручного восстановления отвергнутой пары в scope SR-07 нет.

AI получает исключительно список названий признаков, их matched/contradicted/unknown и безопасные объяснения правил; ни адресов/цен/URL, ни текстов продавцов/контактов. Используется существующий `SearchAi.analyzeDescriptions` через persistent AiGate с лимитами и ledger. Нет автоматического подтверждения/слияния. Платные вызовы в этой задаче не выполнялись; тест — инъекция fake порта.

## Проверки и метрики

`npx tsx scripts/search-quality/evaluate.ts` подключён к `domain/quality-adapter.ts` (одна точечная правка вне модуля, по поручению). Разметка, fingerprint данных, baseline.json и пороги не изменены; fingerprint текущего кода включает модуль дедупликации.

REPLAY живого обезличенного среза 05.11.2026, без сети и AI: D01 L04/L22, D02 L06/L21, D03 L15/L27 обнаружены. TP=3, FP=0, FN=0, TN=2; precision=1, recall=1; baseline TP=0/FN=3. Unlabelled predictions=0; три unknown-пары исключены из знаменателя. Все 49 объявлений сохранены. Это качество вероятных пар на данном эталоне; подтверждённых точных merge в эталоне нет, exactMergeAccuracy=N/A. Метрики не доказывают полноту по всему рынку.

Тесты: `tests/unit/listing-duplicates.test.ts`, `tests/integration/listing-duplicates.test.ts`, `tests/authorization/listing-duplicates.test.ts`; дополнительно регрессия `tests/unit/property-search/quality-baseline.test.ts`. PostgreSQL: выделенная crm_test_d, global setup пересоздаёт только её схему. Проверяются допуски/адреса/ложные совпадения, группировка и конкурентный запуск, сохранение решений, split, запрет транзитивного обхода, 409, аудит, fake AI без изменения данных, 401/403/deactivated, обе роли, отсутствие ПДн/сырых JSON.

Схема/миграции/зависимости не менялись; npm install не запускался. Визуальная проверка страницы поиска остаётся у агента UI после подключения компонентов. ТЗ.txt в репозитории отсутствует; нормативный v3.1 прочитан полностью, использованы существующие соглашения и схема.

Фактический завершающий прогон 05.11.2026: Vitest **31/31 PASS**, 4 файла, exit 0 (17 unit дедупликации + 7 unit эталона + 6 integration + 1 authorization). Целевой ESLint **PASS**, exit 0. `evaluate.ts` **PASS**, exit 0; метрики приведены выше. `npx tsc --noEmit` exit 2: ошибки вне зоны в разрабатываемых параллельно document-templates/ai/ai-chat; диагностик listing-duplicates и изменённого evaluate.ts нет. Повтор общего typecheck требуется после завершения этих агентов. Фактические логи текущей рабочей копии: `listing-duplicates-{tests,lint,quality,tsc}.log` (не добавлять в Git).
