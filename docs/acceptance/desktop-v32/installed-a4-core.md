# Installed a4 core — packaged browser/Chromium (ограниченный PASS)

Дата испытания: 2026-11-08. Проверка выполнена на отдельных синтетических данных установленной CRM.

## Границы прогона

- Статус: **ограниченный PASS 12/12 parent + 12/12 business** для конкретного прогона `run-26b62a10-9ae2-4ecd-98ee-6c6c94a7a89d` (данные `data/qa-v32-installed-browser/run-26b62a10-9ae2-4ecd-98ee-6c6c94a7a89d/result.json`).
- Среда: headless packaged Chromium `156.0.8078.4` + установленный supervisor `--smoke`; Node `24.15.0`; SQLite `3.51.2`.
- **Не доказано:** полный нативный WebView desktop walkthrough, физический offline на уровне ОС, clean consumer Windows 10/11 VM. `0 external HTTP requests` в браузере **не** означает физический offline.
- Синтетические скриншоты (10): `docs/screenshots/vkr/` с префиксом `v32-installed-26b62a10-9ae2-4ecd-98ee-6c6c94a7a89d-`.

## Что фактически проверено

| Область | Факт |
|---|---|
| UI | setup, login, экраны, форма клиента — синтетические данные/скриншоты заполнены. |
| API/business | need, task, property, collection, offer, document authorization; цикл завершён. |
| Артефакты | Реальные DOCX/PDF/XLSX/ZIP созданы. PDF: 2 страницы A4, читаем; метка назначения «Коммерческая»; origin ссылки `127.0.0.1:4011` корректен **на момент создания**. |
| Перезапуск | Данные сохранились после restart. Restart на порту `14572` — persisted link across restart **не доказан**. |
| Экраны «Сегодня/планировщик» | Скриншоты сделаны до создания бизнес-данных — пустое состояние легитимно. |

## Связанные доказательства

- Текущий EXE a4: [release-artifacts.md](../../desktop/release-artifacts.md).
- Облачный installed-контур (отдельный run, ограниченный): [installed-a4-cloud.md](installed-a4-cloud.md) — настройка обоих облаков и фактическое восстановление из каждого.

## Не считается готовностью

Этот протокол **не** делает релиз v3.2.1 полностью готовым. Остаются: текущий a4 local backup/handoff refresh (старые 71e-доказательства остаются валидными в своих границах), installed PG→SQLite, installed Excel UI, физический network cut, полный native picker/tray/reboot/reminder matrix, clean Windows 10/11 consumer VM (BLOCKED по решению пользователя).