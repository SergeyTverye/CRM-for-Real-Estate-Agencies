"""Reconcile reviewed captures and checksums; never contacts the CRM or AI."""
from pathlib import Path
import hashlib
import json
from datetime import datetime, timezone
from decimal import Decimal

root = Path("docs/screenshots/vkr")
now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
records = json.loads(Path("data/polish-screenshots-records.json").read_text(encoding="utf-8"))
aliases = {
    "24-repeat-confirm.png": "23-repeat-confirm.png",
    "31-web-cards.png": "31-web-corrected.png",
    "32-cian-status.png": "31-web-corrected.png",
    "21-manual-web-browser.png": "31-web-corrected.png",
    "07-web-fallback-live.png": "34-auto-web-cards.png",
    "28-fallback-statuses.png": "34-auto-web-cards.png",
    "22-preserved-bookmarks.png": "08-bookmarks.png",
}
for name in aliases:
    (root / "live-ai" / name).unlink(missing_ok=True)
records = [r for r in records if (root / r["file"]).is_file()]
manifest = {r["file"]: r for r in json.loads((root / "manifest.json").read_text(encoding="utf-8")) if (root / r["file"]).is_file()}
for r in records:
    r["visuallyReviewed"] = True
    manifest[r["file"]] = r
for p in sorted(root.rglob("*.png")):
    file = p.relative_to(root).as_posix()
    if file not in manifest:
        manifest[file] = {"file": file, "scenario": "Исходный кадр другого испытания, без пересъёмки", "date": None, "sha": None,
                          "mode": "LIVE original; see live-ai-trials.md" if file.startswith("live-ai/") else "DEMO original",
                          "fileModifiedAt": datetime.fromtimestamp(p.stat().st_mtime, timezone.utc).isoformat()}
    manifest[file]["sha256"] = hashlib.sha256(p.read_bytes()).hexdigest()
ordered = sorted(manifest.values(), key=lambda r: r["file"])
(root / "manifest.json").write_text(json.dumps(ordered, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(root / "SHA256SUMS").write_text("".join(f'{r["sha256"]}  {r["file"]}\n' for r in ordered), encoding="utf-8")
live = [r for r in ordered if r["file"].startswith("live-ai/")]
(root / "live-ai" / "manifest.json").write_text(json.dumps(live, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(root / "live-ai" / "SHA256SUMS").write_text("".join(f'{r["sha256"]}  {Path(r["file"]).name}\n' for r in live), encoding="utf-8")

path = Path("docs/vkr/live-ai-evidence.json")
evidence = json.loads(path.read_text(encoding="utf-8"))
previous_polish = evidence.get("polishCapture", {})
usage = json.loads(Path("data/polish-usage.json").read_text(encoding="utf-8"))
usage = [{"id": r["id"], "time": r["createdAt"], "jobId": r["result"]["jobId"], "type": r["callType"], "status": r["status"],
          "input": r["inputTokens"], "output": r["outputTokens"], "webSearchCalls": r["result"]["webSearchCalls"],
          "chargedRub": str(Decimal(r["result"]["chargedMicros"]) / Decimal(1000000))} for r in usage]
original = evidence.get("totalsBeforePolish", evidence["totals"])
cost = sum((Decimal(r["chargedRub"]) for r in usage), Decimal(0))
evidence["totalsBeforePolish"] = original
evidence["totals"] = {**original, "input": original["input"] + sum(r["input"] for r in usage),
                      "output": original["output"] + sum(r["output"] for r in usage), "other": original["other"] + len(usage),
                      "calls": original["calls"] + len(usage), "rub": str(Decimal(original["rub"]) + cost)}
evidence["polishCapture"] = {"updatedAt": now, "host": "localhost:3390", "distDir": ".next-shots", "viewport": {"width": 1440, "height": 1000},
                            "savedReplayAiEnabled": False, "newParseCalls": len(usage), "newWebCalls": 0, "newScraperRuns": 0,
                            "usage": usage, "addedCostCrmRub": str(cost), "cloudBillingAvailable": False,
                            "parseAttempts": json.loads(Path("data/polish-parse-calls.json").read_text(encoding="utf-8")),
                            "screenshots": records, "deduplicatedAliases": aliases}
old_shots = evidence.get("secondPass", {}).get("screenshots", [])
if old_shots:
    evidence["polishCapture"]["supersededScreenshotReferences"] = previous_polish.get("supersededScreenshotReferences", old_shots)
    replacements = {}
    for r in old_shots:
        name = aliases.get(Path(r["file"]).name, Path(r["file"]).name)
        file = "live-ai/" + name
        current = manifest[file]
        replacements[file] = {"file": "docs/screenshots/vkr/" + file, "mode": current["mode"], "date": current.get("date"), "sourceTime": current.get("sourceTime"), "sha256": current["sha256"]}
    evidence["secondPass"]["screenshots"] = list(replacements.values())
path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

path = Path("docs/vkr/screenshots.md")
doc = path.read_text(encoding="utf-8")
for r in records:
    if not r["file"].startswith("live-ai/"):
        rows = doc.splitlines()
        for i, line in enumerate(rows):
            if line.startswith("| [" + r["file"] + "]"):
                cells = line.split(" | ")
                if len(cells) >= 4:
                    cells[2] = r["date"]
                    rows[i] = " | ".join(cells)
        doc = "\n".join(rows) + "\n"
header = "\n## Финальная полировка КП и пересъёмка LIVE\n"
doc = doc.split(header)[0]
doc += header + "\nПорт 3390, NEXT_DIST_DIR=.next-shots, webpack dev, devIndicators=false уже установлен в общей конфигурации другим агентом. Viewport этих кадров 1440×1000, ru-RU, Asia/Novosibirsk. DEMO 10/10b/10c/10d пересняты; 10c и 10d — настоящий PDF через html-pdf, страницы 1 и 2. Все четыре страницы PDF и четыре страницы DOCX отрендерены и просмотрены. DEMO LegalEntity не содержит логотипа/реквизитов/телефона; в старом снимке назначения нет — сведения не выдумывались. При заполнении LegalEntity логотип и реквизиты выводятся; это покрыто integration-тестом.\n"
if "10d-offer-pdf-page2.png" in manifest:
    r = manifest["10d-offer-pdf-page2.png"]
    doc += f'\n[10d-offer-pdf-page2.png](../screenshots/vkr/10d-offer-pdf-page2.png): DEMO, A4 PDF страница 2, кадр {r["date"]}.\n'
doc += "\n### LIVE — режим и источник\n\nСохранённые SearchRun, закладки, подборка и КП загружены из crm_demo с AI_ENABLED=false. На каждом таком кадре стоит подпись «LIVE-данные, сохранённые при испытании <время>, кадр переснят без новых вызовов». Это сохранённые LIVE-данные, а не повторное подтверждение доступности площадок. Время источника и время кадра указаны отдельно. Нижняя подпись добавлена только harness; данные и ответы CRM не подменяются. Тосты закрываются штатно, Next N отключён конфигурацией.\n\nКадры 01/02, 12/13, 14/15, 16/17 — четыре новых настоящих parse-вызова 13:34 UTC, с отдельной подписью LIVE. Новых web-вызовов и запусков скрапера нет. Старые подтверждения платного запуска, бюджеты и p2-* оставлены как исторические кадры исходных испытаний; они не объявляются переснятыми.\n\n| Кадр | Режим | Источник / время UTC | Время кадра UTC |\n|---|---|---|---|\n"
for r in records:
    if r["file"].startswith("live-ai/"):
        file = r["file"]
        doc += f'| [{Path(file).name}](../screenshots/vkr/{file}) | {r["mode"]} | {r.get("runId", "parse") or "parse"} · {r.get("sourceTime", "—")} | {r["date"]} |\n'
doc += "\nУдалены повторные кадры; ссылки-замены: " + "; ".join(f"`{a}` → `{b}`" for a, b in aliases.items()) + ". В manifest и SHA256SUMS записаны только существующие PNG; дата неизвестных исходных кадров не выдумывается. Каждый переснятый кадр просмотрен.\n"
path.write_text(doc, encoding="utf-8")

path = Path("docs/vkr/live-ai-trials.md")
doc = path.read_text(encoding="utf-8")
header = "\n## Итог финальной пересъёмки КП и LIVE\n"
doc = doc.split(header)[0]
doc += header + f"\nДополнительно выполнены ровно 4 успешных LIVE parse-вызова: input 2215, output 642, web 0, известная стоимость журнала CRM {cost} ₽. Итого с исходным LIVE-прогоном: прочих AI-вызовов 12/25, web_search 5/5, стоимость CRM {evidence['totals']['rub']} ₽; Cloud billing не проверен. Первое HTTP 409 в 13:31 UTC не создало AiUsageLog и не дошло до оплачиваемого dispatch. Причина: восстановленные исходные суточные квоты 3 на пользователя / 10 всего. На время разрешённых четырёх вызовов квоты установлены как фактическое число записей дня + 4; бюджет 250 ₽. Затем восстановлены все исходные настройки (квоты 3/10, бюджет 1000 ₽), ENV-потолки не повышались.\n"
doc += "\nLIVE-проверка новых ответов: «любые районы» очистило старый район; уточнение «исключи цоколь» сохранило first_floor_only. Модель вернула часть признаков техническими кодами separate_entrance/wet_point/showcase/gates/power_from_50_kW; это видно на подлинных кадрах и остаётся замечанием к русификации UI, в данной зоне не исправлялось. Старые ошибки исходных ответов в журнале сохранены.\n\nСохранённые результаты, статусы, закладки, подборка, сравнение, КП и результаты после фактического перезапуска приложения пересняты на порту 3390 при AI_ENABLED=false. На кадре и в реестре: «LIVE-данные, сохранённые при испытании <время>, кадр переснят без новых вызовов». Никаких новых scraper/web запусков для этих кадров. Восстановленный run bce2a997-e54a-4ac6-9c8b-564f5e9845ac показывает прежние результаты; кадр 36 снят после остановки и запуска собственного сервера. Никаких утверждений о новых объявлениях или изменениях цен по этим кадрам нет.\n\nDEMO PDF и DOCX: по четыре страницы, просмотрены все PNG. Изменены только шаблоны; application/offer-document.ts делегирует сборку DOCX вынесенному presentation/offer-docx.ts. src/modules/ai и html-pdf.ts не менялись. tsc --noEmit PASS; целевой ESLint PASS; offer-export integration/authorization 3/3 PASS на crm_test_b. Полный Playwright и build не запускались, npm install и миграций нет.\n\nПовторные PNG удалены: " + "; ".join(f"`{a}` → `{b}`" for a, b in aliases.items()) + ". См. screenshots.md и manifest/SHA256SUMS. Исторические подтверждения платного запуска, исходные бюджеты и чужие p2-кадры не переснимались и не выдаются за новые.\n"
path.write_text(doc, encoding="utf-8")
print(f"Manifest: {len(ordered)} PNG; reviewed updated records: {len(records)}; added parse cost {cost} RUB")
