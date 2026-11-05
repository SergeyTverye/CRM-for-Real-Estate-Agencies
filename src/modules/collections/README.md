# Подборки v3.1: контракт для агента серверного поиска

`import { addItems } from "@/modules/collections/application/collection-service"`.

`await addItems(actor, collectionId, [{ externalListingId: listingId }, { propertyId }])`
→ `{ added: number }`. В элементе ровно одна ссылка (XOR). Максимум 500 ссылок за вызов,
1000 элементов в подборке. Повторные ссылки пропускаются. Весь вызов атомарный;
порядок добавления сохраняется; конкурентные операции сериализуются блокировкой строки подборки.
Никаких Property, NeedPropertyMatch или фактов отправки не создаётся.
Недоступная private, архивная либо запрещённая для изменения подборка → 404.
Team читают сотрудники; изменяют владелец и manager. Чужая private скрыта и от manager.

Агент поиска: замените fallback `addListingToCollection` в `bulk-service.ts` прямым вызовом
`addItems(actor, collectionId, [{ externalListingId: listingId }])`.
Наличие собственной конфигурации порта не требуется. Код поискового модуля здесь не изменялся.

Экспорт переиспользует `escapeSpreadsheet` и `csvCell` из
`@/modules/property-search/application/export-service`: сохраняйте эти именованные экспорты.
Оба формата подборок используют тот же sanitizer.

API: GET/POST `/collections`, GET/PATCH `/collections/{id}`,
POST `/collections/{id}/items` `{items:[...]}`, PATCH `/items/{itemId}`
`{expectedUpdatedAt,status?,comment?,exclusionReason?}`;
POST `/items/{itemId}` `{action:transfer|propose|verify,...}`;
POST `/needs` `{expectedUpdatedAt,needId,unlink?}`;
GET `/export?format=csv|xlsx`; POST `/offer` `{needId,itemIds}`.
URL всех операций начинается с `/api/v1/collections`.

Team DTO не содержит недоступных потребностей, клиентов и комментариев/причин,
если хотя бы одна связанная потребность недоступна. Пикер и привязка требуют
одновременно доступ к потребности и её клиенту. Комментарии не копируются в КП.
КП создаётся действующим createOffer; снимки, запрет неявного переноса и отсутствие
отправки/Match сохраняются. Проверки внешних объявлений — существующий verifyListing.
