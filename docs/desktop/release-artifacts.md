# Windows desktop: текущий артефакт a982542a (не принят)

Текущий официальный артефакт CI: commit `a982542a40bab1e2f5667c336f2edd314ee96fa0`, run [42408326567](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42408326567), статус полностью SUCCESS: build + installer 2022/2025, unit 1791 PASS / 5 skip, SQLite 398 PASS / 1 skip, Rust 1, финальный runtime PASS.

Артефакт: [13589677235](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42408326567/artifacts/13589677235). Файл `releases/windows-x64/CRM-Setup-Windows-x64.exe`, 585 556 902 байт. SHA-256: `1c818d455cf758edcba5b12aa591f1956c28f4cd8f919772304f6b062b57a0ed`. ZIP/EXE/commit проверены.

Установка на Windows 11:
- overinstall поверх 71e8765 с оставшимся маркером сборки 41: первый запуск exit 1 из-за устаревшего пустого файла `app/public/.gitkeep`; после ручного удаления только этого пустого файла повторная тихая установка exit 0;
- пользовательские данные не изменены;
- strict runtime policy PASS: внутренние TZ/source-файлы не попали в программу.
- свежий профиль: setup/login и POST клиента PASS; `GET /clients/{uuid}` возвращает 500 из-за отсутствующего скомпилированного чанка Next `node_modules_next_dist_esm_build_templates_app-page_0tzz75ki_2zv7.js`;
- cloud restore не выполнялся: остановлено до настроек облака из-за ошибки карточки клиента.

Сборка a982 не принята для выпуска из-за ошибки открытия карточки клиента.

Исправление пустого заполнителя: commit `5b8613e`, PS5-тесты PASS, независимое ревью без замечаний. Его CI `42414736304` отменён для экономии ресурсов, потому что всё ещё требуется исправление скомпилированного чанка. Исправление полноты скомпилированного сервера проходит проверку; нового проверенного артефакта пока нет. `main` остаётся на a982; рабочая ветка `codex/installed-release-proof`.

Linux production: образ `02d8478e47dbbee51ab8632b4b9797046b8623e3910560f70b07d4cf9c467079`, Node 24.22.2. PostgreSQL 9/9, SQLite 22/22, фактический restore PASS; восстановленное прерывание транспорта не засчитано как PASS. Docker production не затронут.

История и ограничения: [installed-followup-20261107.md](../acceptance/desktop-v32/installed-followup-20261107.md). Ожидается обновление follow-up по результатам следующего исправления.

## Исторические сборки (не текущая загрузка)
- `71e8765`: Windows Server 2022/2025 lifecycle PASS; на Windows 11 проверены setup/login/основные экраны/бизнес-цикл. Не текущий файл для загрузки; найдены obsolete program resources и неверный desktop-port в PDF-ссылке. Протокол: [installed-71e8765.md](../acceptance/desktop-v32/installed-71e8765.md).
- `41c39b8` / `7e7e47e`: более ранние smoke-сборки; обычное окно не работало. Их результаты не являются приёмкой a982.

Consumer Windows 10/11 VM-части остаются BLOCKED по решению пользователя.
