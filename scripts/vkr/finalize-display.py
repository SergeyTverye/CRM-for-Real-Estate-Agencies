"""Update only the nine reviewed final-display captures; no network or CRM writes."""
from pathlib import Path
import hashlib
import json

root = Path("docs/screenshots/vkr")
files = ["10-offer.png", "10b-offer-print.png", "10c-offer-pdf-page1.png", "10d-offer-pdf-page2.png"] + [
    "live-ai/" + name + ".png" for name in
    ["04-live-results", "05-evidence", "19-rent-results", "25-repeat-results", "26-comparison"]
]
records = json.loads(Path("data/polish-screenshots-records.json").read_text(encoding="utf-8"))
updates = {}
for file in files:
    row = next(r.copy() for r in reversed(records) if r["file"] == file)
    row.update(sha256=hashlib.sha256((root / file).read_bytes()).hexdigest(), visuallyReviewed=True,
               sourceState="working tree; final display fixes; uncommitted", newAiCalls=0, newScraperRuns=0,
               captureHost="localhost:3395")
    updates[file] = row

manifest = {r["file"]: r for r in json.loads((root / "manifest.json").read_text(encoding="utf-8"))}
manifest.update(updates)
for file in files:
    assert (root / file).is_file()
ordered = sorted(manifest.values(), key=lambda r: r["file"])
for rows, directory, live in [(ordered, root, False), ([r for r in ordered if r["file"].startswith("live-ai/")], root / "live-ai", True)]:
    (directory / "manifest.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (directory / "SHA256SUMS").write_text("".join(f'{r["sha256"]}  {Path(r["file"]).name if live else r["file"]}\n' for r in rows), encoding="utf-8")

path = Path("docs/vkr/screenshots.md")
doc = path.read_text(encoding="utf-8")
doc = doc.replace("DEMO LegalEntity не содержит логотипа/реквизитов/телефона; в старом снимке назначения нет — сведения не выдумывались.",
                  "Первоначальный прогон был без реквизитов и назначения; это исправлено при пересъёмке на порту 3395, см. ниже.")
header = "\n## Финальные исправления отображения (порт 3395)\n"
doc = doc.split(header)[0] + header
doc += """
Режим: crm_demo, webpack dev, 1440×1000, ru-RU, Asia/Novosibirsk; AI_ENABLED=false,
YANDEX_WEB_SEARCH_ENABLED=false, SCRAPER_ENABLED=false. Все POST/PUT/DELETE поиска и ИИ
дополнительно заблокированы Playwright harness. Новых вызовов Yandex/ИИ/скрапера нет:
AiUsageLog до/после — 35 записей. Исторические платные испытания выше не изменены.

Выполнено `npx tsx scripts/vkr/polish-screenshots.ts final-only`.
DEMO 10/10b/10c/10d и пять LIVE-кадров ниже пересняты и просмотрены.
10c/10d — страницы 1/2 настоящего PDF; PDF и DOCX содержат по четыре страницы A4.
DOCX проверен через LibreOffice → PDF → Poppler, просмотрены все страницы.
Полная шапка: синтетические ИНН/ОГРН-образцы с пометкой ДЕМО, адрес,
телефон +7 900 000-00-.., example.ru и простой PNG, созданный локально через Sharp без ImageGen.
Seed `npm run db:seed:demo` применён к crm_demo; повторный запуск не создаёт дублей.

Причина пустого назначения: формирование прежнего снимка учитывало только
Property.commercialPurpose, а демо-объекты имеют Property.propertyType.
Печать/PDF/DOCX используют снимок назначения в приоритете; только при отсутствии
значения используют коммерческое назначение/тип Property с русской меткой.
Исторические снимки цены, адреса, площади и условий не переписаны.

Контракт real-estate-scrapper 2.1.0 проверен локально: yandex/onrealt/mirkvartir
возвращают address, district и title. Заголовок ранее терялся нормализацией,
а пустой address="" обходил fallback через `??`. Теперь пробелы/пустые строки
считаются отсутствием, title сохраняется, читаются вложенные raw/normalized снимки.
В сохранённых ответах Яндекса адрес действительно пуст, старый title не сохранён:
без повторного запроса восстановить их нельзя. Показываются «Адрес не указан площадкой»
и доступный фрагмент описания; для новых снимков — настоящий title. Адрес не выдумывается.
Продажа без единицы показана «за объект»; аренда — «единица цены не указана»,
вкладка «Требуют проверки». Критерии, источники доказательств и состояния русифицированы.

На каждом LIVE-кадре сохранена плашка «LIVE-данные, сохранённые при испытании …,
кадр переснят без новых вызовов». Это повторное отображение сохранённых данных,
а не новое испытание доступности площадок. SHA — базовый HEAD; изменения ещё не закоммичены.

Проверки: tsc --noEmit; ESLint изменённых TS/TSX; 7 регрессионных тестов отображения,
85 unit-тестов поиска, 7 demo-тестов; 3 integration/authorization-теста экспорта на crm_test_c.
Все PASS. Полный Playwright-набор не запускался. Миграций и npm install нет.

| Кадр | Время кадра UTC | Сохранённый источник UTC | SHA256 |
|---|---|---|---|
"""
for file, row in updates.items():
    doc += f'| [{file}](../screenshots/vkr/{file}) | {row["date"]} | {row.get("sourceTime", "DEMO")} | `{row["sha256"]}` |\n'
path.write_text(doc, encoding="utf-8")
print(f"Updated {len(updates)} reviewed captures and both checksum manifests")
