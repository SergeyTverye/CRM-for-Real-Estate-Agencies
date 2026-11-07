# Windows EXE

Текущий официальный EXE `71e8765` скачан в `releases/windows-x64/CRM-Setup-Windows-x64.exe`, отдельная папка исключена из Git/Docker. Размер 585603587 байт. ZIP/EXE SHA и commit build-measurements проверены.

SHA-256: `a3e5ab26cbe6bcd249f2f222994052c4f985541c46b81910b9221d3262be311e`.

[Артефакт GitHub Actions](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42396531730/artifacts/13584259822). Windows Server2022/2025 installer lifecycle PASS. На текущем Windows11 обычное окно, setup/login, основные экраны, настоящий business cycle с DOCX/PDF/XLSX/ZIP и клиент после перезапуска проверены; [точный протокол и ограничения](../acceptance/desktop-v32/installed-71e8765.md).

**Полный выпуск ещё не принят.** Найдены obsolete program resources при обновлении со старой версии и неверный desktop-port в PDF ссылке; source fixes подготовлены для следующего EXE. Installed cloud/USB/native picker и полный handoff/restore gate ещё выполняются. Consumer Windows10/11 VM-части BLOCKED по решению пользователя.

## История предыдущего артефакта
### Сборка41c39b8

Локальная папка: `releases/windows-x64/`, исключена из Git и Docker context. В ней оставлена одна версия EXE с SHA-256, SBOM и сведениями runtime; проверенные дубликаты ZIP/EXE удалены.

Текущая скачанная сборка — `41c39b8`: [артефакт GitHub Actions](https://github.com/SergeyTverye/CRM-for-Real-Estate-Agencies/actions/runs/42313787406/artifacts/13550879559). Размер EXE: 585 583 866 байт.

```text
b56ec7501a9b9ebc9328f9e1dfc03cf452b8e10611bae0675bb4eb6f4262126b
```

**Готовность не подтверждена.** Сборка и Rust-тесты в Windows CI прошли; обе установочные проверки завершились `SMOKE_EXIT_BEFORE_READY`. На текущем ПК после удаления предыдущей версии выполнена чистая установка (exit 0), проверено отсутствие root ТЗ/AGENTS/CLAUDE/docs/tests/src/scripts/ops в программной папке. Пользовательские данные установкой не удалялись.

Причина текущего отказа воспроизведена в новом синтетическом профиле: отсутствуют Next/Turbopack hashed aliases под `.next-desktop/node_modules`; модуль `@prisma/client-2c3a283f134fdcb6/runtime/client` не найден. Исходное исправление сохраняет необходимые runtime-пакеты и скомпилированные API, материализует только проверенные внутренние junction-псевдонимы и добавляет проверку финального пакета до Rust/NSIS. Новая сборка и фактическое обычное окно ещё ожидаются.

Предыдущая сборка `7e7e47e` имела отдельный дефект verbatim Windows resource path и избыточный trace проекта. Её installed smoke backup/verify/restore и A→B/conflict сценарии были проверены на синтетических данных, но обычное окно не работало, а обратный receive блокировался. Эти результаты не являются приёмкой новой сборки. Чистые Windows 10/11 VM отсутствуют по решению пользователя; Windows Server CI их не заменяет.

См. [запуск](../acceptance/desktop-v32/native-startup.md), [перенос](../acceptance/desktop-v32/installed-handoff.md) и [матрицу приёмки](../acceptance/desktop-v32/README.md).
