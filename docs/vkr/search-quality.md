# Проверка качества поиска — AT-01, AT-07, AT-08

Данные **LIVE**, получены при испытаниях **05.11.2026**; этот прогон **REPLAY**, без сети, БД и AI. Новых живых запросов нет. Это базовая линия качества, а не PASS всей приёмки AT-01/07/08.

## Методика и состав

Отобраны 49 записей: 46 карточек объявлений и 3 отрицательных контроля — страницы выдачи (L45–L47). Источник — read-only выборка crm_demo: ExternalListing → ExternalListingSnapshot → SearchRun и SearchRunResult, только run ID из docs/vkr/live-ai-evidence.json. В этих запусках 311 уникальных URL; ранее 591 — число результатов по запускам, а не уникальных объявлений. Синтетические объявления исключены. SHA256 исходного evidence сохранён в фикстуре; UUID служат только трассировке происхождения.

Источники: {"mirkvartir":15,"onrealt":21,"yandex":11,"web_search":2}. Истинное назначение: {"commercial":36,"mixed":3,"residential":5,"unknown":5}. Web Search — способ получения страниц, а не дополнительная площадка с проверенными карточками. Реальных карточек Авито/Циан/Домклик в этих данных нет; их заменять синтетикой нельзя.

Разметка в annotations.ts введена вручную после чтения текста/полей, независимо от evaluateListing. Проверены коммерческий тип, операция, цена/единица, площадь, этаж, явно названные признаки, дата, вероятная дубль-группа и четыре ожидаемых вердикта. commercial — подтверждённое назначение по объявлению; residential — явно жилое; mixed — коммерческое/неопределённое помещение в жилом окружении; unknown — недостаточно фактов (включая апартаменты с неизвестным юридическим статусом). mixed не означает автоматическое отклонение.

Цена из поля не считается независимо проверенной: amount_unverified_from_excerpt. Отдельно отмечены явные цена/единица; 100 ₽/м² за первый месяц у L16 не равно 100 ₽ за весь объект. Неизвестный период аренды → needs_review. Поле площади — наблюдение источника, не обмер; конфликт/округление отмечен. Отсутствие упоминания витрины, входа, ворот не означает false; пустая features означает unknown. Будущий вход на согласовании не считается существующим.

Тексты обезличены, сокращены до 300 символов; URL сохранены, фото и контакты исключены. Заголовков в старых снимках нет (title=null), они не выдуманы. Оценивается именно эта фиксированная сокращённая проекция, а не полный текст страницы. Возможные доказательства за её пределами не учитываются. Старые снимки не содержат purposeSource; отсутствие сохранено, чтобы не скрыть фактическое поведение правила. Web Search source проецируется в код площадки только для совместимости доменного типа; исходный код остаётся в input.source.

### Запросы

- **office-sale**: Продажа офиса, Новосибирск, 30–500 м², 1–50 млн ₽.
- **industrial-rent**: Аренда склада ИЛИ производства, 200–1000 м², ₽/месяц.
- **retail-rent**: Аренда торговли, первый этаж, отдельный вход, ₽/месяц.
- **commercial-sale**: Продажа офис/торговля/ПСН, первый этаж, отдельный вход.

Эталонный confirmed требует отсутствия неизвестных обязательных условий; needs_review — коммерчески правдоподобный кандидат с неизвестными условиями; rejected — явное противоречие или страница выдачи вместо конкретного лота. ПСН без явного офисного назначения требует уточнения для офиса. Юридически квартира отклоняется, даже если предлагается как готовый офис. Чисто жилой текст ЖК без доказательства коммерческого лота считается ложным коммерческим совпадением.

Ложное включение: expected=rejected, actual=confirmed/needs_review (считаются отдельно). Ложное исключение: expected=confirmed/needs_review, actual=rejected. Доли: соответственно от всех expectedRejected и expectedIncluded, не от всего набора. Ошибки точного вердикта дополнительно учитывают confirmed ↔ needs_review.

## Базовая линия до v3.1

Базовая линия заморожена в baseline.json. Отпечаток кода: `0b4b2ba2d67cb635dad90caf7188d4f5a54f1703f344e1a51b4cbdd4ad5991e1`.

| Запрос | Проверок | Должны отклоняться | Должны включаться | Ложные включения (confirmed / review) | Ложные исключения | Ошибки точного вердикта |
|---|---:|---:|---:|---:|---:|---:|
| office-sale | 49 | 30 | 19 | 8 (1 / 7) | 0 | 12 |
| industrial-rent | 49 | 29 | 20 | 2 (0 / 2) | 0 | 2 |
| retail-rent | 49 | 48 | 1 | 2 (0 / 2) | 1 | 3 |
| commercial-sale | 49 | 43 | 6 | 9 (0 / 9) | 0 | 10 |

Всего 196 пар объявление × запрос. Ложных включений **21/150**, исключений **1/46**. Точное несовпадение вердикта: 27. Неизвестных дат публикации: **49/49** (100%). fetchedAt/firstSeenAt не подменяют публикацию.

Дубли: TP=0, FP=0, FN=3, TN=2; precision=N/A (нет предсказаний), recall=0. Это качество обнаружения **подозреваемых пар** по 3 положительным и 2 отрицательным разметкам, а не доказанная тождественность объектов. Три спорные пары исключены из знаменателя; остальные неразмеченные пары не считаются отрицательными. Accuracy точного объединения = N/A: эталонных доказанных межплощадочных дублей нет. Сохранены 49 источников.

### Главные классы ошибок и примеры

- [L26](https://onrealt.ru/novosibirsk/kypit-ofis/86528478), office-sale: rejected → confirmed (false_inclusion). Прямо: оформлена как квартира. Маркетинг офиса и отдельный вход не меняют жилое назначение.
- [L28](https://onrealt.ru/novosibirsk/kypit-ofis/86528532), office-sale: needs_review → confirmed (review_boundary). Апартаменты Port i7 с обещанием представительства: юридический статус не указан; не подтверждать офис и не выдумывать жилой статус.
- [L29](https://onrealt.ru/novosibirsk/kypit-ofis/86528560), office-sale: needs_review → confirmed (review_boundary). Прямо ПСН/мастерская, первый этаж, отдельный вход; офисное использование требует уточнения.
- [L34](https://onrealt.ru/novosibirsk/kypit-ofis/86528919), office-sale: needs_review → confirmed (review_boundary). ЖК Лофт Наука назван бизнес-пространством; назначение конкретного лота и вход не установлены.
- [L35](https://onrealt.ru/novosibirsk/kypit-ofis/86529376), office-sale: needs_review → confirmed (review_boundary). Помещение в ЖК, обмен на нежилое не доказывает статус; этаж 14; требуется проверка.
- [L39](https://realty.yandex.ru/offer/3936023035793471937/), office-sale: rejected → needs_review (false_inclusion). Описание ЖК Паскаль и квартир без доказательства коммерческого помещения.
- [L40](https://realty.yandex.ru/offer/3936755696708953458/), office-sale: rejected → needs_review (false_inclusion). Прямо квартира в Собрании; назначение office в снимке неверно.
- [L41](https://realty.yandex.ru/offer/3936755696708953459/), office-sale: rejected → needs_review (false_inclusion). Другая квартира Собрания: площадь/цена отличаются от L40; не дубль.
- [L42](https://realty.yandex.ru/offer/3939986640549968619/), office-sale: rejected → needs_review (false_inclusion). Прямо продажа квартир ЖК Ньютон; office ошибочен.
- [L45](https://novosibirsk.cian.ru/kupit-ofis-30-metrov/), office-sale: rejected → needs_review (false_inclusion). Страница выдачи Циан, не карточка конкретного объявления.
- [L46](https://onrealt.ru/novosibirsk/kypit-ofis-nedorogo), office-sale: rejected → needs_review (false_inclusion). Страница категории OnRealt, цена/площадь неизвестны, не конкретный лот.
- [L47](https://www.avito.ru/novosibirsk/kommercheskaya_nedvizhimost/prodam/magazin-ASgBAgICAkSwCNJWnsMNiNk5?q=%D0%BA%D1%83%D0%BF%D0%B8%D1%82%D1%8C+%D0%B3%D0%BE%D1%82%D0%BE%D0%B2%D1%8B%D0%B9+%D0%B0%D1%80%D0%B5%D0%BD%D0%B4%D0%BD%D1%8B%D0%B9+%D0%B1%D0%B8%D0%B7%D0%BD%D0%B5%D1%81+%D1%81+%D0%B0%D1%80%D0%B5%D0%BD%D0%B4%D0%B0%D1%82%D0%BE%D1%80%D0%BE%D0%BC), office-sale: rejected → needs_review (false_inclusion). Поисковая ссылка Авито с фрагментом о магазине, не проверяемая карточка лота; число 339,2 не переносим в поле площади.
- [L44](https://realty.yandex.ru/offer/7567068812130613982/), retail-rent: needs_review → rejected (false_exclusion). Жилой дом + деловой центр + коммерция на первых этажах; назначение конкретного лота, операция и этаж неизвестны.
- [L30](https://onrealt.ru/novosibirsk/kypit-ofis/86528614), commercial-sale: needs_review → confirmed (review_boundary). Отдельный вход только на согласовании, существование не подтверждено.
- [L33](https://onrealt.ru/novosibirsk/kypit-ofis/86528882), commercial-sale: rejected → needs_review (false_inclusion). Цоколь прямо указан: поле первого этажа ошибочно; подходит офису без ограничения этажа.
- [L48](https://realty.yandex.ru/offer/889555503400285658/), commercial-sale: rejected → needs_review (false_inclusion). Офис/коммерческое помещение; в описании этаж 19 против поля 1; город/единица цены отсутствуют.

Дополнительные диагностические прогоны вызывают текущее purpose-правило, parseFloor, parsePriceUnit и evaluateFeature. Четыре конфликтных этажа (L19, L23, L33, L48) сравниваются с ручной разметкой; parseFloor работает с ошибочным исходным floorRaw и не читает описание. Для L16/L27 цена проверяется по явному тексту. Это проверки нормализации имеющихся полей, не повторный парсинг HTML: сырой HTML/package Listing в старой БД не сохранён. Полный normalizeListing без исходного raw не воспроизводим; выдуманного raw нет.

У пяти жилых примеров purpose-правило не даёт отрицательного критерия (0/5): старые снимки содержат purpose=office, но не содержат purposeSource. Текущий early return доверяет этому полю как структурированному; коммерческая формулировка также может маскировать юридически жилой статус (L26). Отдельный класс — страницы выдачи L45–L47, которые общий оценщик пропускает как needs_review при неизвестных полях. Эти результаты относятся к replay старых снимков, а не к доказанной точности нового парсинга.

Вероятные дубли D01–D03 пропускаются при строгом сравнении адресов (город/сокращения/номер дома). Совпадения одной цены/площади недостаточно для auto-merge.

## Ограничения и дальнейшие проверки

- В исходном срезе нет подтверждённых положительных примеров аренды торговли на первом этаже: retail-rent проверяет отрицательные/неопределённые случаи, полноту положительной выдачи не доказывает. Есть явное торговое использование ПСН L31/L33/L43.
- Все даты неизвестны: набор обнаруживает отсутствие publication date, но не проверяет точность разбора известных дат и свежести.
- Неизвестные цена/площадь представлены страницами выдачи, не реальными карточками с пропущенными полями; положительное поведение таких карточек требует следующего LIVE среза.
- Разметка одним агентом по сохранённым публичным фрагментам — экспертная интерпретация для регрессии, без независимой проверки человеком/документов объекта.
- AT-08 здесь проверяет доменные вердикты без AI. Платный анализ, интерфейс сравнения и ограниченный LIVE smoke остаются у соответствующих агентов.

## Воспроизведение и защита от регрессии

`npx tsx scripts/search-quality/evaluate.ts` — таблица и JSON в stdout; `--write` обновляет этот отчёт, сохраняя baseline.json. `npx vitest run --project unit tests/unit/property-search/quality-baseline.test.ts` — «не хуже» по каждому запросу и источнику: отдельно falseConfirmed, falseInclusions, falseExclusions, exactVerdictErrors (число falseNeedsReview выводится отдельно; downgrade ошибочного confirmed → needs_review разрешён); по дублям FP/FN не растут, TP/TN не падают. Менять пороги вместе с поисковым исправлением нельзя. Фикстура и ручная разметка защищены fingerprint.

Для намеренного нового эталона: отдельное review разметки, затем явный `--freeze-baseline --write`. Обычный прогон никогда не перезаписывает пороги. GroupingAdapter позволяет подключить будущую функцию группировки.

## Текущий REPLAY

| Запрос | Проверок | Должны отклоняться | Должны включаться | Ложные включения (confirmed / review) | Ложные исключения | Ошибки точного вердикта |
|---|---:|---:|---:|---:|---:|---:|
| office-sale | 49 | 30 | 19 | 0 (0 / 0) | 0 | 3 |
| industrial-rent | 49 | 29 | 20 | 0 (0 / 0) | 0 | 0 |
| retail-rent | 49 | 48 | 1 | 0 (0 / 0) | 0 | 0 |
| commercial-sale | 49 | 43 | 6 | 1 (0 / 1) | 0 | 2 |

### JSON: замороженная базовая линия

```json
{
  "mode": "REPLAY",
  "sourceMode": "LIVE",
  "collectedOn": "2026-11-05",
  "networkCalls": 0,
  "aiCalls": 0,
  "fixtureFingerprint": "8e737a9b5e62e1569c79039a66010872c05293a29839ae7151571f175e32e505",
  "codeFingerprint": "0b4b2ba2d67cb635dad90caf7188d4f5a54f1703f344e1a51b4cbdd4ad5991e1",
  "composition": {
    "total": 49,
    "bySource": {
      "mirkvartir": 15,
      "onrealt": 21,
      "yandex": 11,
      "web_search": 2
    },
    "byTrueType": {
      "commercial": 36,
      "mixed": 3,
      "residential": 5,
      "unknown": 5
    },
    "byRecordKind": {
      "listing": 46,
      "search_page": 3
    },
    "populationUniqueUrls": 311
  },
  "totals": {
    "cases": 196,
    "expectedRejected": 150,
    "expectedIncluded": 46,
    "falseInclusions": 21,
    "falseConfirmed": 1,
    "falseNeedsReview": 20,
    "falseExclusions": 1,
    "exactVerdictErrors": 27,
    "falseInclusionRate": 0.14,
    "falseExclusionRate": 0.021739
  },
  "perQuery": {
    "office-sale": {
      "cases": 49,
      "expectedRejected": 30,
      "expectedIncluded": 19,
      "falseInclusions": 8,
      "falseConfirmed": 1,
      "falseNeedsReview": 7,
      "falseExclusions": 0,
      "exactVerdictErrors": 12
    },
    "industrial-rent": {
      "cases": 49,
      "expectedRejected": 29,
      "expectedIncluded": 20,
      "falseInclusions": 2,
      "falseConfirmed": 0,
      "falseNeedsReview": 2,
      "falseExclusions": 0,
      "exactVerdictErrors": 2
    },
    "retail-rent": {
      "cases": 49,
      "expectedRejected": 48,
      "expectedIncluded": 1,
      "falseInclusions": 2,
      "falseConfirmed": 0,
      "falseNeedsReview": 2,
      "falseExclusions": 1,
      "exactVerdictErrors": 3
    },
    "commercial-sale": {
      "cases": 49,
      "expectedRejected": 43,
      "expectedIncluded": 6,
      "falseInclusions": 9,
      "falseConfirmed": 0,
      "falseNeedsReview": 9,
      "falseExclusions": 0,
      "exactVerdictErrors": 10
    }
  },
  "perSource": {
    "mirkvartir": {
      "cases": 60,
      "expectedRejected": 47,
      "expectedIncluded": 13,
      "falseInclusions": 0,
      "falseConfirmed": 0,
      "falseNeedsReview": 0,
      "falseExclusions": 0,
      "exactVerdictErrors": 0
    },
    "onrealt": {
      "cases": 84,
      "expectedRejected": 61,
      "expectedIncluded": 23,
      "falseInclusions": 4,
      "falseConfirmed": 1,
      "falseNeedsReview": 3,
      "falseExclusions": 0,
      "exactVerdictErrors": 9
    },
    "yandex": {
      "cases": 44,
      "expectedRejected": 34,
      "expectedIncluded": 10,
      "falseInclusions": 9,
      "falseConfirmed": 0,
      "falseNeedsReview": 9,
      "falseExclusions": 1,
      "exactVerdictErrors": 10
    },
    "web_search": {
      "cases": 8,
      "expectedRejected": 8,
      "expectedIncluded": 0,
      "falseInclusions": 8,
      "falseConfirmed": 0,
      "falseNeedsReview": 8,
      "falseExclusions": 0,
      "exactVerdictErrors": 8
    }
  },
  "dates": {
    "unknown": 49,
    "total": 49,
    "share": 1,
    "knownPublicationDates": 0
  },
  "deduplication": {
    "tp": 0,
    "fp": 0,
    "fn": 3,
    "tn": 2,
    "precision": null,
    "recall": 0,
    "annotatedPairs": 5,
    "unknownPairsExcluded": 3,
    "unlabelledPredictions": 0,
    "retained": 49,
    "exactMergeAccuracy": null,
    "predictions": []
  },
  "diagnostics": {
    "residentialPurposeRule": {
      "total": 5,
      "rejected": 0
    },
    "floorNormalization": [
      {
        "id": "L19",
        "url": "https://onrealt.ru/novosibirsk/arenda-sklada/86633004",
        "expected": {
          "kind": "above_ground",
          "number": 3
        },
        "actual": {
          "kind": "above_ground",
          "number": 2,
          "raw": "2"
        },
        "correct": false
      },
      {
        "id": "L23",
        "url": "https://onrealt.ru/novosibirsk/arenda-sklada/86633281",
        "expected": {
          "kind": "above_ground",
          "number": 2
        },
        "actual": {
          "kind": "above_ground",
          "number": 1,
          "raw": "1"
        },
        "correct": false
      },
      {
        "id": "L33",
        "url": "https://onrealt.ru/novosibirsk/kypit-ofis/86528882",
        "expected": {
          "kind": "semi_basement",
          "number": null
        },
        "actual": {
          "kind": "above_ground",
          "number": 1,
          "raw": "1"
        },
        "correct": false
      },
      {
        "id": "L48",
        "url": "https://realty.yandex.ru/offer/889555503400285658/",
        "expected": {
          "kind": "above_ground",
          "number": 19
        },
        "actual": {
          "kind": "above_ground",
          "number": 1,
          "raw": "1"
        },
        "correct": false
      }
    ],
    "priceUnitNormalization": [
      {
        "id": "L16",
        "expected": "rub_m2_month",
        "actual": "rub_m2_month"
      },
      {
        "id": "L27",
        "expected": "rub_total",
        "actual": "rub_total"
      }
    ],
    "features": [
      {
        "id": "L19",
        "feature": "separate_entrance",
        "expected": "matched",
        "actual": "matched"
      },
      {
        "id": "L19",
        "feature": "gates",
        "expected": "matched",
        "actual": "matched"
      },
      {
        "id": "L20",
        "feature": "gates",
        "expected": "matched",
        "actual": "matched"
      },
      {
        "id": "L22",
        "feature": "gates",
        "expected": "matched",
        "actual": "matched"
      },
      {
        "id": "L24",
        "feature": "wet_point",
        "expected": "matched",
        "actual": "matched"
      },
      {
        "id": "L26",
        "feature": "separate_entrance",
        "expected": "matched",
        "actual": "matched"
      },
      {
        "id": "L29",
        "feature": "separate_entrance",
        "expected": "matched",
        "actual": "matched"
      },
      {
        "id": "L31",
        "feature": "separate_entrance",
        "expected": "matched",
        "actual": "matched"
      },
      {
        "id": "L31",
        "feature": "first_line",
        "expected": "matched",
        "actual": "matched"
      }
    ]
  },
  "errors": [
    {
      "id": "L26",
      "query": "office-sale",
      "expected": "rejected",
      "actual": "confirmed",
      "kind": "false_inclusion",
      "url": "https://onrealt.ru/novosibirsk/kypit-ofis/86528478",
      "reason": "Прямо: оформлена как квартира. Маркетинг офиса и отдельный вход не меняют жилое назначение.",
      "criteria": [
        {
          "criterion": "city",
          "state": "matched",
          "source": "structured",
          "evidence": "Новосибирск"
        },
        {
          "criterion": "operation",
          "state": "matched",
          "source": "structured",
          "evidence": "sale"
        },
        {
          "criterion": "purpose",
          "state": "matched",
          "source": "structured",
          "evidence": "office"
        },
        {
          "criterion": "priceUnit",
          "state": "matched",
          "source": "structured",
          "evidence": "rub_total"
        },
        {
          "criterion": "price",
          "state": "matched",
          "source": "structured",
          "evidence": "19500000.00 rub_total"
        },
        {
          "criterion": "area",
          "state": "matched",
          "source": "structured",
          "evidence": "126.5"
        }
      ]
    },
    {
      "id": "L28",
      "query": "office-sale",
      "expected": "needs_review",
      "actual": "confirmed",
      "kind": "review_boundary",
      "url": "https://onrealt.ru/novosibirsk/kypit-ofis/86528532",
      "reason": "Апартаменты Port i7 с обещанием представительства: юридический статус не указан; не подтверждать офис и не выдумывать жилой статус.",
      "criteria": [
        {
          "criterion": "city",
          "state": "matched",
          "source": "structured",
          "evidence": "Новосибирск"
        },
        {
          "criterion": "operation",
          "state": "matched",
          "source": "structured",
          "evidence": "sale"
        },
        {
          "criterion": "purpose",
          "state": "matched",
          "source": "structured",
          "evidence": "office"
        },
        {
          "criterion": "priceUnit",
          "state": "matched",
          "source": "structured",
          "evidence": "rub_total"
        },
        {
          "criterion": "price",
          "state": "matched",
          "source": "structured",
          "evidence": "19000000.00 rub_total"
        },
        {
          "criterion": "area",
          "state": "matched",
          "source": "structured",
          "evidence": "75.5"
        }
      ]
    },
    {
      "id": "L29",
      "query": "office-sale",
      "expected": "needs_review",
      "actual": "confirmed",
      "kind": "review_boundary",
      "url": "https://onrealt.ru/novosibirsk/kypit-ofis/86528560",
      "reason": "Прямо ПСН/мастерская, первый этаж, отдельный вход; офисное использование требует уточнения.",
      "criteria": [
        {
          "criterion": "city",
          "state": "matched",
          "source": "structured",
          "evidence": "Новосибирск"
        },
        {
          "criterion": "operation",
          "state": "matched",
          "source": "structured",
          "evidence": "sale"
        },
        {
          "criterion": "purpose",
          "state": "matched",
          "source": "structured",
          "evidence": "office"
        },
        {
          "criterion": "priceUnit",
          "state": "matched",
          "source": "structured",
          "evidence": "rub_total"
        },
        {
          "criterion": "price",
          "state": "matched",
          "source": "structured",
          "evidence": "10000000.00 rub_total"
        },
        {
          "criterion": "area",
          "state": "matched",
          "source": "structured",
          "evidence": "92.8"
        }
      ]
    },
    {
      "id": "L34",
      "query": "office-sale",
      "expected": "needs_review",
      "actual": "confirmed",
      "kind": "review_boundary",
      "url": "https://onrealt.ru/novosibirsk/kypit-ofis/86528919",
      "reason": "ЖК Лофт Наука назван бизнес-пространством; назначение конкретного лота и вход не установлены.",
      "criteria": [
        {
          "criterion": "city",
          "state": "matched",
          "source": "structured",
          "evidence": "Новосибирск"
        },
        {
          "criterion": "operation",
          "state": "matched",
          "source": "structured",
          "evidence": "sale"
        },
        {
          "criterion": "purpose",
          "state": "matched",
          "source": "structured",
          "evidence": "office"
        },
        {
          "criterion": "priceUnit",
          "state": "matched",
          "source": "structured",
          "evidence": "rub_total"
        },
        {
          "criterion": "price",
          "state": "matched",
          "source": "structured",
          "evidence": "20400000.00 rub_total"
        },
        {
          "criterion": "area",
          "state": "matched",
          "source": "structured",
          "evidence": "125.3"
        }
      ]
    },
    {
      "id": "L35",
      "query": "office-sale",
      "expected": "needs_review",
      "actual": "confirmed",
      "kind": "review_boundary",
      "url": "https://onrealt.ru/novosibirsk/kypit-ofis/86529376",
      "reason": "Помещение в ЖК, обмен на нежилое не доказывает статус; этаж 14; требуется проверка.",
      "criteria": [
        {
          "criterion": "city",
          "state": "matched",
          "source": "structured",
          "evidence": "Новосибирск"
        },
        {
          "criterion": "operation",
          "state": "matched",
          "source": "structured",
          "evidence": "sale"
        },
        {
          "criterion": "purpose",
          "state": "matched",
          "source": "structured",
          "evidence": "office"
        },
        {
          "criterion": "priceUnit",
          "state": "matched",
          "source": "structured",
          "evidence": "rub_total"
        },
        {
          "criterion": "price",
          "state": "matched",
          "source": "structured",
          "evidence": "12500000.00 rub_total"
        },
        {
          "criterion": "area",
          "state": "matched",
          "source": "structured",
          "evidence": "72"
        }
      ]
    },
    {
      "id": "L39",
      "query": "office-sale",
      "expected": "rejected",
      "actual": "needs_review",
      "kind": "false_inclusion",
      "url": "https://realty.yandex.ru/offer/3936023035793471937/",
      "reason": "Описание ЖК Паскаль и квартир без доказательства коммерческого помещения.",
      "criteria": [
        {
          "criterion": "city",
          "state": "unknown",
          "source": "structured",
          "evidence": "Город неизвестен"
        },
        {
          "criterion": "operation",
          "state": "unknown",
          "source": "structured",
          "evidence": "Операция неизвестна"
        },
        {
          "criterion": "purpose",
          "state": "matched",
          "source": "structured",
          "evidence": "office"
        },
        {
          "criterion": "priceUnit",
          "state": "unknown",
          "source": "structured",
          "evidence": "Единица цены неизвестна"
        },
        {
          "criterion": "price",
          "state": "unknown",
          "source": "structured",
          "evidence": "24640000.00 ?"
        },
        {
          "criterion": "area",
          "state": "matched",
          "source": "structured",
          "evidence": "112"
        }
      ]
    },
    {
      "id": "L40",
      "query": "office-sale",
      "expected": "rejected",
      "actual": "needs_review",
      "kind": "false_inclusion",
      "url": "https://realty.yandex.ru/offer/3936755696708953458/",
      "reason": "Прямо квартира в Собрании; назначение office в снимке неверно.",
      "criteria": [
        {
          "criterion": "city",
          "state": "unknown",
          "source": "structured",
          "evidence": "Город неизвестен"
        },
        {
          "criterion": "operation",
          "state": "unknown",
          "source": "structured",
          "evidence": "Операция неизвестна"
        },
        {
          "criterion": "purpose",
          "state": "matched",
          "source": "structured",
          "evidence": "office"
        },
        {
          "criterion": "priceUnit",
          "state": "unknown",
          "source": "structured",
          "evidence": "Единица цены неизвестна"
        },
        {
          "criterion": "price",
          "state": "unknown",
          "source": "structured",
          "evidence": "57400000.00 ?"
        },
        {
          "criterion": "area",
          "state": "matched",
          "source": "structured",
          "evidence": "241.6"
        }
      ]
    },
    {
      "id": "L41",
      "query": "office-sale",
      "expected": "rejected",
      "actual": "needs_review",
      "kind": "false_inclusion",
      "url": "https://realty.yandex.ru/offer/3936755696708953459/",
      "reason": "Другая квартира Собрания: площадь/цена отличаются от L40; не дубль.",
      "criteria": [
        {
          "criterion": "city",
          "state": "unknown",
          "source": "structured",
          "evidence": "Город неизвестен"
        },
        {
          "criterion": "operation",
          "state": "unknown",
          "source": "structured",
          "evidence": "Операция неизвестна"
        },
        {
          "criterion": "purpose",
          "state": "matched",
          "source": "structured",
          "evidence": "office"
        },
        {
          "criterion": "priceUnit",
          "state": "unknown",
          "source": "structured",
          "evidence": "Единица цены неизвестна"
        },
        {
          "criterion": "price",
          "state": "unknown",
          "source": "structured",
          "evidence": "63000000.00 ?"
        },
        {
          "criterion": "area",
          "state": "matched",
          "source": "structured",
          "evidence": "240.5"
        }
      ]
    },
    {
      "id": "L42",
      "query": "office-sale",
      "expected": "rejected",
      "actual": "needs_review",
      "kind": "false_inclusion",
      "url": "https://realty.yandex.ru/offer/3939986640549968619/",
      "reason": "Прямо продажа квартир ЖК Ньютон; office ошибочен.",
      "criteria": [
        {
          "criterion": "city",
          "state": "unknown",
          "source": "structured",
          "evidence": "Город неизвестен"
        },
        {
          "criterion": "operation",
          "state": "unknown",
          "source": "structured",
          "evidence": "Операция неизвестна"
        },
        {
          "criterion": "purpose",
          "state": "matched",
          "source": "structured",
          "evidence": "office"
        },
        {
          "criterion": "priceUnit",
          "state": "unknown",
          "source": "structured",
          "evidence": "Единица цены неизвестна"
        },
        {
          "criterion": "price",
          "state": "unknown",
          "source": "structured",
          "evidence": "18495000.00 ?"
        },
        {
          "criterion": "area",
          "state": "matched",
          "source": "structured",
          "evidence": "61.7"
        }
      ]
    },
    {
      "id": "L45",
      "query": "office-sale",
      "expected": "rejected",
      "actual": "needs_review",
      "kind": "false_inclusion",
      "url": "https://novosibirsk.cian.ru/kupit-ofis-30-metrov/",
      "reason": "Страница выдачи Циан, не карточка конкретного объявления.",
      "criteria": [
        {
          "criterion": "city",
          "state": "unknown",
          "source": "structured",
          "evidence": "Город неизвестен"
        },
        {
          "criterion": "operation",
          "state": "unknown",
          "source": "structured",
          "evidence": "Операция неизвестна"
        },
        {
          "criterion": "purpose",
          "state": "unknown",
          "source": "structured",
          "evidence": "Назначение неизвестно"
        },
        {
          "criterion": "priceUnit",
          "state": "unknown",
          "source": "structured",
          "evidence": "Единица цены неизвестна"
        },
        {
          "criterion": "price",
          "state": "unknown",
          "source": "structured",
          "evidence": "? ?"
        },
        {
          "criterion": "area",
          "state": "unknown",
          "source": "structured",
          "evidence": "Площадь неизвестна"
        }
      ]
    },
    {
      "id": "L46",
      "query": "office-sale",
      "expected": "rejected",
      "actual": "needs_review",
      "kind": "false_inclusion",
      "url": "https://onrealt.ru/novosibirsk/kypit-ofis-nedorogo",
      "reason": "Страница категории OnRealt, цена/площадь неизвестны, не конкретный лот.",
      "criteria": [
        {
          "criterion": "city",
          "state": "unknown",
          "source": "structured",
          "evidence": "Город неизвестен"
        },
        {
          "criterion": "operation",
          "state": "matched",
          "source": "structured",
          "evidence": "sale"
        },
        {
          "criterion": "purpose",
          "state": "matched",
          "source": "structured",
          "evidence": "office"
        },
        {
          "criterion": "priceUnit",
          "state": "matched",
          "source": "structured",
          "evidence": "rub_total"
        },
        {
          "criterion": "price",
          "state": "unknown",
          "source": "structured",
          "evidence": "? rub_total"
        },
        {
          "criterion": "area",
          "state": "unknown",
          "source": "structured",
          "evidence": "Площадь неизвестна"
        }
      ]
    },
    {
      "id": "L47",
      "query": "office-sale",
      "expected": "rejected",
      "actual": "needs_review",
      "kind": "false_inclusion",
      "url": "https://www.avito.ru/novosibirsk/kommercheskaya_nedvizhimost/prodam/magazin-ASgBAgICAkSwCNJWnsMNiNk5?q=%D0%BA%D1%83%D0%BF%D0%B8%D1%82%D1%8C+%D0%B3%D0%BE%D1%82%D0%BE%D0%B2%D1%8B%D0%B9+%D0%B0%D1%80%D0%B5%D0%BD%D0%B4%D0%BD%D1%8B%D0%B9+%D0%B1%D0%B8%D0%B7%D0%BD%D0%B5%D1%81+%D1%81+%D0%B0%D1%80%D0%B5%D0%BD%D0%B4%D0%B0%D1%82%D0%BE%D1%80%D0%BE%D0%BC",
      "reason": "Поисковая ссылка Авито с фрагментом о магазине, не проверяемая карточка лота; число 339,2 не переносим в поле площади.",
      "criteria": [
        {
          "criterion": "city",
          "state": "unknown",
          "source": "structured",
          "evidence": "Город неизвестен"
        },
        {
          "criterion": "operation",
          "state": "unknown",
          "source": "structured",
          "evidence": "Операция неизвестна"
        },
        {
          "criterion": "purpose",
          "state": "unknown",
          "source": "structured",
          "evidence": "Назначение неизвестно"
        },
        {
          "criterion": "priceUnit",
          "state": "unknown",
          "source": "structured",
          "evidence": "Единица цены неизвестна"
        },
        {
          "criterion": "price",
          "state": "unknown",
          "source": "structured",
          "evidence": "? ?"
        },
        {
          "criterion": "area",
          "state": "unknown",
          "source": "structured",
          "evidence": "Площадь неизвестна"
        }
      ]
    },
    {
      "id": "L45",
      "query": "industrial-rent",
      "expected": "rejected",
      "actual": "needs_review",
      "kind": "false_inclusion",
      "url": "https://novosibirsk.cian.ru/kupit-ofis-30-metrov/",
      "reason": "Страница выдачи Циан, не карточка конкретного объявления.",
      "criteria": [
        {
          "criterion": "city",
          "state": "unknown",
          "source": "structured",
          "evidence": "Город неизвестен"
        },
        {
          "criterion": "operation",
          "state": "unknown",
          "source": "structured",
          "evidence": "Операция неизвестна"
        },
        {
          "criterion": "purpose",
          "state": "unknown",
          "source": "structured",
          "evidence": "Назначение неизвестно"
        },
        {
          "criterion": "priceUnit",
          "state": "unknown",
          "source": "structured",
          "evidence": "Единица цены неизвестна"
        },
        {
          "criterion": "area",
          "state": "unknown",
          "source": "structured",
          "evidence": "Площадь неизвестна"
        }
      ]
    },
    {
      "id": "L47",
      "query": "industrial-rent",
      "expected": "rejected",
      "actual": "needs_review",
      "kind": "false_inclusion",
      "url": "https://www.avito.ru/novosibirsk/kommercheskaya_nedvizhimost/prodam/magazin-ASgBAgICAkSwCNJWnsMNiNk5?q=%D0%BA%D1%83%D0%BF%D0%B8%D1%82%D1%8C+%D0%B3%D0%BE%D1%82%D0%BE%D0%B2%D1%8B%D0%B9+%D0%B0%D1%80%D0%B5%D0%BD%D0%B4%D0%BD%D1%8B%D0%B9+%D0%B1%D0%B8%D0%B7%D0%BD%D0%B5%D1%81+%D1%81+%D0%B0%D1%80%D0%B5%D0%BD%D0%B4%D0%B0%D1%82%D0%BE%D1%80%D0%BE%D0%BC",
      "reason": "Поисковая ссылка Авито с фрагментом о магазине, не проверяемая карточка лота; число 339,2 не переносим в поле площади.",
      "criteria": [
        {
          "criterion": "city",
          "state": "unknown",
          "source": "structured",
          "evidence": "Город неизвестен"
        },
        {
          "criterion": "operation",
          "state": "unknown",
          "source": "structured",
          "evidence": "Операция неизвестна"
        },
        {
          "criterion": "purpose",
          "state": "unknown",
          "source": "structured",
          "evidence": "Назначение неизвестно"
        },
        {
          "criterion": "priceUnit",
          "state": "unknown",
          "source": "structured",
          "evidence": "Единица цены неизвестна"
        },
        {
          "criterion": "area",
          "state": "unknown",
          "source": "structured",
          "evidence": "Площадь неизвестна"
        }
      ]
    },
    {
      "id": "L44",
      "query": "retail-rent",
      "expected": "needs_review",
      "actual": "rejected",
      "kind": "false_exclusion",
      "url": "https://realty.yandex.ru/offer/7567068812130613982/",
      "reason": "Жилой дом + деловой центр + коммерция на первых этажах; назначение конкретного лота, операция и этаж неизвестны.",
      "criteria": [
        {
          "criterion": "city",
          "state": "unknown",
          "source": "structured",
          "evidence": "Город неизвестен"
        },
        {
          "criterion": "operation",
          "state": "unknown",
          "source": "structured",
          "evidence": "Операция неизвестна"
        },
        {
          "criterion": "purpose",
          "state": "contradicted",
          "source": "structured",
          "evidence": "office"
        },
        {
          "criterion": "priceUnit",
          "state": "unknown",
          "source": "structured",
          "evidence": "Единица цены неизвестна"
        },
        {
          "criterion": "floor",
          "state": "unknown",
          "source": "structured",
          "evidence": "Этаж неизвестен"
        },
        {
          "criterion": "отдельный вход",
          "state": "unknown",
          "source": "rule",
          "evidence": "Нет подтверждающих сведений"
        }
      ]
    },
    {
      "id": "L45",
      "query": "retail-rent",
      "expected": "rejected",
      "actual": "needs_review",
      "kind": "false_inclusion",
      "url": "https://novosibirsk.cian.ru/kupit-ofis-30-metrov/",
      "reason": "Страница выдачи Циан, не карточка конкретного объявления.",
      "criteria": [
        {
          "criterion": "city",
          "state": "unknown",
          "source": "structured",
          "evidence": "Город неизвестен"
        },
        {
          "criterion": "operation",
          "state": "unknown",
          "source": "structured",
          "evidence": "Операция неизвестна"
        },
        {
          "criterion": "purpose",
          "state": "unknown",
          "source": "structured",
          "evidence": "Назначение неизвестно"
        },
        {
          "criterion": "priceUnit",
          "state": "unknown",
          "source": "structured",
          "evidence": "Единица цены неизвестна"
        },
        {
          "criterion": "floor",
          "state": "unknown",
          "source": "structured",
          "evidence": "Этаж неизвестен"
        },
        {
          "criterion": "отдельный вход",
          "state": "unknown",
          "source": "rule",
          "evidence": "Нет подтверждающих сведений"
        }
      ]
    },
    {
      "id": "L47",
      "query": "retail-rent",
      "expected": "rejected",
      "actual": "needs_review",
      "kind": "false_inclusion",
      "url": "https://www.avito.ru/novosibirsk/kommercheskaya_nedvizhimost/prodam/magazin-ASgBAgICAkSwCNJWnsMNiNk5?q=%D0%BA%D1%83%D0%BF%D0%B8%D1%82%D1%8C+%D0%B3%D0%BE%D1%82%D0%BE%D0%B2%D1%8B%D0%B9+%D0%B0%D1%80%D0%B5%D0%BD%D0%B4%D0%BD%D1%8B%D0%B9+%D0%B1%D0%B8%D0%B7%D0%BD%D0%B5%D1%81+%D1%81+%D0%B0%D1%80%D0%B5%D0%BD%D0%B4%D0%B0%D1%82%D0%BE%D1%80%D0%BE%D0%BC",
      "reason": "Поисковая ссылка Авито с фрагментом о магазине, не проверяемая карточка лота; число 339,2 не переносим в поле площади.",
      "criteria": [
        {
          "criterion": "city",
          "state": "unknown",
          "source": "structured",
          "evidence": "Город неизвестен"
        },
        {
          "criterion": "operation",
          "state": "unknown",
          "source": "structured",
          "evidence": "Операция неизвестна"
        },
        {
          "criterion": "purpose",
          "state": "unknown",
          "source": "structured",
          "evidence": "Назначение неизвестно"
        },
        {
          "criterion": "priceUnit",
          "state": "unknown",
          "source": "structured",
          "evidence": "Единица цены неизвестна"
        },
        {
          "criterion": "floor",
          "state": "unknown",
          "source": "structured",
          "evidence": "Этаж неизвестен"
        },
        {
          "criterion": "отдельный вход",
          "state": "unknown",
          "source": "rule",
          "evidence": "Нет подтверждающих сведений"
        }
      ]
    },
    {
      "id": "L30",
      "query": "commercial-sale",
      "expected": "needs_review",
      "actual": "confirmed",
      "kind": "review_boundary",
      "url": "https://onrealt.ru/novosibirsk/kypit-ofis/86528614",
      "reason": "Отдельный вход только на согласовании, существование не подтверждено.",
      "criteria": [
        {
          "criterion": "city",
          "state": "matched",
          "source": "structured",
          "evidence": "Новосибирск"
        },
        {
          "criterion": "operation",
          "state": "matched",
          "source": "structured",
          "evidence": "sale"
        },
        {
          "criterion": "purpose",
          "state": "matched",
          "source": "structured",
          "evidence": "office"
        },
        {
          "criterion": "floor",
          "state": "matched",
          "source": "structured",
          "evidence": "1"
        },
        {
          "criterion": "отдельный вход",
          "source": "rule",
          "evidence": "Подготовлена документация для согласования отдельного входа",
          "state": "matched"
        }
      ]
    },
    {
      "id": "L33",
      "query": "commercial-sale",
      "expected": "rejected",
      "actual": "needs_review",
      "kind": "false_inclusion",
      "url": "https://onrealt.ru/novosibirsk/kypit-ofis/86528882",
      "reason": "Цоколь прямо указан: поле первого этажа ошибочно; подходит офису без ограничения этажа.",
      "criteria": [
        {
          "criterion": "city",
          "state": "matched",
          "source": "structured",
          "evidence": "Новосибирск"
        },
        {
          "criterion": "operation",
          "state": "matched",
          "source": "structured",
          "evidence": "sale"
        },
        {
          "criterion": "purpose",
          "state": "matched",
          "source": "structured",
          "evidence": "office"
        },
        {
          "criterion": "floor",
          "state": "matched",
          "source": "structured",
          "evidence": "1"
        },
        {
          "criterion": "отдельный вход",
          "state": "unknown",
          "source": "rule",
          "evidence": "Нет подтверждающих сведений"
        }
      ]
    },
    {
      "id": "L39",
      "query": "commercial-sale",
      "expected": "rejected",
      "actual": "needs_review",
      "kind": "false_inclusion",
      "url": "https://realty.yandex.ru/offer/3936023035793471937/",
      "reason": "Описание ЖК Паскаль и квартир без доказательства коммерческого помещения.",
      "criteria": [
        {
          "criterion": "city",
          "state": "unknown",
          "source": "structured",
          "evidence": "Город неизвестен"
        },
        {
          "criterion": "operation",
          "state": "unknown",
          "source": "structured",
          "evidence": "Операция неизвестна"
        },
        {
          "criterion": "purpose",
          "state": "matched",
          "source": "structured",
          "evidence": "office"
        },
        {
          "criterion": "floor",
          "state": "matched",
          "source": "structured",
          "evidence": "1"
        },
        {
          "criterion": "отдельный вход",
          "state": "unknown",
          "source": "rule",
          "evidence": "Нет подтверждающих сведений"
        }
      ]
    },
    {
      "id": "L40",
      "query": "commercial-sale",
      "expected": "rejected",
      "actual": "needs_review",
      "kind": "false_inclusion",
      "url": "https://realty.yandex.ru/offer/3936755696708953458/",
      "reason": "Прямо квартира в Собрании; назначение office в снимке неверно.",
      "criteria": [
        {
          "criterion": "city",
          "state": "unknown",
          "source": "structured",
          "evidence": "Город неизвестен"
        },
        {
          "criterion": "operation",
          "state": "unknown",
          "source": "structured",
          "evidence": "Операция неизвестна"
        },
        {
          "criterion": "purpose",
          "state": "matched",
          "source": "structured",
          "evidence": "office"
        },
        {
          "criterion": "floor",
          "state": "matched",
          "source": "structured",
          "evidence": "1"
        },
        {
          "criterion": "отдельный вход",
          "state": "unknown",
          "source": "rule",
          "evidence": "Нет подтверждающих сведений"
        }
      ]
    },
    {
      "id": "L41",
      "query": "commercial-sale",
      "expected": "rejected",
      "actual": "needs_review",
      "kind": "false_inclusion",
      "url": "https://realty.yandex.ru/offer/3936755696708953459/",
      "reason": "Другая квартира Собрания: площадь/цена отличаются от L40; не дубль.",
      "criteria": [
        {
          "criterion": "city",
          "state": "unknown",
          "source": "structured",
          "evidence": "Город неизвестен"
        },
        {
          "criterion": "operation",
          "state": "unknown",
          "source": "structured",
          "evidence": "Операция неизвестна"
        },
        {
          "criterion": "purpose",
          "state": "matched",
          "source": "structured",
          "evidence": "office"
        },
        {
          "criterion": "floor",
          "state": "matched",
          "source": "structured",
          "evidence": "1"
        },
        {
          "criterion": "отдельный вход",
          "state": "unknown",
          "source": "rule",
          "evidence": "Нет подтверждающих сведений"
        }
      ]
    },
    {
      "id": "L42",
      "query": "commercial-sale",
      "expected": "rejected",
      "actual": "needs_review",
      "kind": "false_inclusion",
      "url": "https://realty.yandex.ru/offer/3939986640549968619/",
      "reason": "Прямо продажа квартир ЖК Ньютон; office ошибочен.",
      "criteria": [
        {
          "criterion": "city",
          "state": "unknown",
          "source": "structured",
          "evidence": "Город неизвестен"
        },
        {
          "criterion": "operation",
          "state": "unknown",
          "source": "structured",
          "evidence": "Операция неизвестна"
        },
        {
          "criterion": "purpose",
          "state": "matched",
          "source": "structured",
          "evidence": "office"
        },
        {
          "criterion": "floor",
          "state": "matched",
          "source": "structured",
          "evidence": "1"
        },
        {
          "criterion": "отдельный вход",
          "state": "unknown",
          "source": "rule",
          "evidence": "Нет подтверждающих сведений"
        }
      ]
    },
    {
      "id": "L45",
      "query": "commercial-sale",
      "expected": "rejected",
      "actual": "needs_review",
      "kind": "false_inclusion",
      "url": "https://novosibirsk.cian.ru/kupit-ofis-30-metrov/",
      "reason": "Страница выдачи Циан, не карточка конкретного объявления.",
      "criteria": [
        {
          "criterion": "city",
          "state": "unknown",
          "source": "structured",
          "evidence": "Город неизвестен"
        },
        {
          "criterion": "operation",
          "state": "unknown",
          "source": "structured",
          "evidence": "Операция неизвестна"
        },
        {
          "criterion": "purpose",
          "state": "unknown",
          "source": "structured",
          "evidence": "Назначение неизвестно"
        },
        {
          "criterion": "floor",
          "state": "unknown",
          "source": "structured",
          "evidence": "Этаж неизвестен"
        },
        {
          "criterion": "отдельный вход",
          "state": "unknown",
          "source": "rule",
          "evidence": "Нет подтверждающих сведений"
        }
      ]
    },
    {
      "id": "L46",
      "query": "commercial-sale",
      "expected": "rejected",
      "actual": "needs_review",
      "kind": "false_inclusion",
      "url": "https://onrealt.ru/novosibirsk/kypit-ofis-nedorogo",
      "reason": "Страница категории OnRealt, цена/площадь неизвестны, не конкретный лот.",
      "criteria": [
        {
          "criterion": "city",
          "state": "unknown",
          "source": "structured",
          "evidence": "Город неизвестен"
        },
        {
          "criterion": "operation",
          "state": "matched",
          "source": "structured",
          "evidence": "sale"
        },
        {
          "criterion": "purpose",
          "state": "matched",
          "source": "structured",
          "evidence": "office"
        },
        {
          "criterion": "floor",
          "state": "unknown",
          "source": "structured",
          "evidence": "Этаж неизвестен"
        },
        {
          "criterion": "отдельный вход",
          "state": "unknown",
          "source": "rule",
          "evidence": "Нет подтверждающих сведений"
        }
      ]
    },
    {
      "id": "L47",
      "query": "commercial-sale",
      "expected": "rejected",
      "actual": "needs_review",
      "kind": "false_inclusion",
      "url": "https://www.avito.ru/novosibirsk/kommercheskaya_nedvizhimost/prodam/magazin-ASgBAgICAkSwCNJWnsMNiNk5?q=%D0%BA%D1%83%D0%BF%D0%B8%D1%82%D1%8C+%D0%B3%D0%BE%D1%82%D0%BE%D0%B2%D1%8B%D0%B9+%D0%B0%D1%80%D0%B5%D0%BD%D0%B4%D0%BD%D1%8B%D0%B9+%D0%B1%D0%B8%D0%B7%D0%BD%D0%B5%D1%81+%D1%81+%D0%B0%D1%80%D0%B5%D0%BD%D0%B4%D0%B0%D1%82%D0%BE%D1%80%D0%BE%D0%BC",
      "reason": "Поисковая ссылка Авито с фрагментом о магазине, не проверяемая карточка лота; число 339,2 не переносим в поле площади.",
      "criteria": [
        {
          "criterion": "city",
          "state": "unknown",
          "source": "structured",
          "evidence": "Город неизвестен"
        },
        {
          "criterion": "operation",
          "state": "unknown",
          "source": "structured",
          "evidence": "Операция неизвестна"
        },
        {
          "criterion": "purpose",
          "state": "unknown",
          "source": "structured",
          "evidence": "Назначение неизвестно"
        },
        {
          "criterion": "floor",
          "state": "unknown",
          "source": "structured",
          "evidence": "Этаж неизвестен"
        },
        {
          "criterion": "отдельный вход",
          "state": "unknown",
          "source": "rule",
          "evidence": "Нет подтверждающих сведений"
        }
      ]
    },
    {
      "id": "L48",
      "query": "commercial-sale",
      "expected": "rejected",
      "actual": "needs_review",
      "kind": "false_inclusion",
      "url": "https://realty.yandex.ru/offer/889555503400285658/",
      "reason": "Офис/коммерческое помещение; в описании этаж 19 против поля 1; город/единица цены отсутствуют.",
      "criteria": [
        {
          "criterion": "city",
          "state": "unknown",
          "source": "structured",
          "evidence": "Город неизвестен"
        },
        {
          "criterion": "operation",
          "state": "unknown",
          "source": "structured",
          "evidence": "Операция неизвестна"
        },
        {
          "criterion": "purpose",
          "state": "matched",
          "source": "structured",
          "evidence": "office"
        },
        {
          "criterion": "floor",
          "state": "matched",
          "source": "structured",
          "evidence": "1"
        },
        {
          "criterion": "отдельный вход",
          "state": "unknown",
          "source": "rule",
          "evidence": "Нет подтверждающих сведений"
        }
      ]
    }
  ]
}
```

### JSON: текущий результат

```json
{
  "mode": "REPLAY",
  "sourceMode": "LIVE",
  "collectedOn": "2026-11-05",
  "networkCalls": 0,
  "aiCalls": 0,
  "fixtureFingerprint": "8e737a9b5e62e1569c79039a66010872c05293a29839ae7151571f175e32e505",
  "codeFingerprint": "68bf86709ae17b02f17ecc05ce443e21cbac08da968b07f1994bc60590e8673f",
  "composition": {
    "total": 49,
    "bySource": {
      "mirkvartir": 15,
      "onrealt": 21,
      "yandex": 11,
      "web_search": 2
    },
    "byTrueType": {
      "commercial": 36,
      "mixed": 3,
      "residential": 5,
      "unknown": 5
    },
    "byRecordKind": {
      "listing": 46,
      "search_page": 3
    },
    "populationUniqueUrls": 311
  },
  "totals": {
    "cases": 196,
    "expectedRejected": 150,
    "expectedIncluded": 46,
    "falseInclusions": 1,
    "falseConfirmed": 0,
    "falseNeedsReview": 1,
    "falseExclusions": 0,
    "exactVerdictErrors": 5,
    "falseInclusionRate": 0.006667,
    "falseExclusionRate": 0
  },
  "perQuery": {
    "office-sale": {
      "cases": 49,
      "expectedRejected": 30,
      "expectedIncluded": 19,
      "falseInclusions": 0,
      "falseConfirmed": 0,
      "falseNeedsReview": 0,
      "falseExclusions": 0,
      "exactVerdictErrors": 3
    },
    "industrial-rent": {
      "cases": 49,
      "expectedRejected": 29,
      "expectedIncluded": 20,
      "falseInclusions": 0,
      "falseConfirmed": 0,
      "falseNeedsReview": 0,
      "falseExclusions": 0,
      "exactVerdictErrors": 0
    },
    "retail-rent": {
      "cases": 49,
      "expectedRejected": 48,
      "expectedIncluded": 1,
      "falseInclusions": 0,
      "falseConfirmed": 0,
      "falseNeedsReview": 0,
      "falseExclusions": 0,
      "exactVerdictErrors": 0
    },
    "commercial-sale": {
      "cases": 49,
      "expectedRejected": 43,
      "expectedIncluded": 6,
      "falseInclusions": 1,
      "falseConfirmed": 0,
      "falseNeedsReview": 1,
      "falseExclusions": 0,
      "exactVerdictErrors": 2
    }
  },
  "perSource": {
    "mirkvartir": {
      "cases": 60,
      "expectedRejected": 47,
      "expectedIncluded": 13,
      "falseInclusions": 0,
      "falseConfirmed": 0,
      "falseNeedsReview": 0,
      "falseExclusions": 0,
      "exactVerdictErrors": 0
    },
    "onrealt": {
      "cases": 84,
      "expectedRejected": 61,
      "expectedIncluded": 23,
      "falseInclusions": 0,
      "falseConfirmed": 0,
      "falseNeedsReview": 0,
      "falseExclusions": 0,
      "exactVerdictErrors": 4
    },
    "yandex": {
      "cases": 44,
      "expectedRejected": 34,
      "expectedIncluded": 10,
      "falseInclusions": 1,
      "falseConfirmed": 0,
      "falseNeedsReview": 1,
      "falseExclusions": 0,
      "exactVerdictErrors": 1
    },
    "web_search": {
      "cases": 8,
      "expectedRejected": 8,
      "expectedIncluded": 0,
      "falseInclusions": 0,
      "falseConfirmed": 0,
      "falseNeedsReview": 0,
      "falseExclusions": 0,
      "exactVerdictErrors": 0
    }
  },
  "dates": {
    "unknown": 49,
    "total": 49,
    "share": 1,
    "knownPublicationDates": 0
  },
  "deduplication": {
    "tp": 3,
    "fp": 0,
    "fn": 0,
    "tn": 2,
    "precision": 1,
    "recall": 1,
    "annotatedPairs": 5,
    "unknownPairsExcluded": 3,
    "unlabelledPredictions": 0,
    "retained": 49,
    "exactMergeAccuracy": null,
    "predictions": [
      {
        "a": "L04",
        "b": "L22",
        "relation": "suspected"
      },
      {
        "a": "L06",
        "b": "L21",
        "relation": "suspected"
      },
      {
        "a": "L15",
        "b": "L27",
        "relation": "suspected"
      }
    ]
  },
  "diagnostics": {
    "residentialPurposeRule": {
      "total": 5,
      "rejected": 5
    },
    "floorNormalization": [
      {
        "id": "L19",
        "url": "https://onrealt.ru/novosibirsk/arenda-sklada/86633004",
        "expected": {
          "kind": "above_ground",
          "number": 3
        },
        "actual": {
          "kind": "above_ground",
          "number": 2,
          "raw": "2"
        },
        "correct": false
      },
      {
        "id": "L23",
        "url": "https://onrealt.ru/novosibirsk/arenda-sklada/86633281",
        "expected": {
          "kind": "above_ground",
          "number": 2
        },
        "actual": {
          "kind": "above_ground",
          "number": 1,
          "raw": "1"
        },
        "correct": false
      },
      {
        "id": "L33",
        "url": "https://onrealt.ru/novosibirsk/kypit-ofis/86528882",
        "expected": {
          "kind": "semi_basement",
          "number": null
        },
        "actual": {
          "kind": "above_ground",
          "number": 1,
          "raw": "1"
        },
        "correct": false
      },
      {
        "id": "L48",
        "url": "https://realty.yandex.ru/offer/889555503400285658/",
        "expected": {
          "kind": "above_ground",
          "number": 19
        },
        "actual": {
          "kind": "above_ground",
          "number": 1,
          "raw": "1"
        },
        "correct": false
      }
    ],
    "priceUnitNormalization": [
      {
        "id": "L16",
        "expected": "rub_m2_month",
        "actual": "rub_m2_month"
      },
      {
        "id": "L27",
        "expected": "rub_total",
        "actual": "rub_total"
      }
    ],
    "features": [
      {
        "id": "L19",
        "feature": "separate_entrance",
        "expected": "matched",
        "actual": "matched"
      },
      {
        "id": "L19",
        "feature": "gates",
        "expected": "matched",
        "actual": "matched"
      },
      {
        "id": "L20",
        "feature": "gates",
        "expected": "matched",
        "actual": "matched"
      },
      {
        "id": "L22",
        "feature": "gates",
        "expected": "matched",
        "actual": "matched"
      },
      {
        "id": "L24",
        "feature": "wet_point",
        "expected": "matched",
        "actual": "matched"
      },
      {
        "id": "L26",
        "feature": "separate_entrance",
        "expected": "matched",
        "actual": "matched"
      },
      {
        "id": "L29",
        "feature": "separate_entrance",
        "expected": "matched",
        "actual": "matched"
      },
      {
        "id": "L31",
        "feature": "separate_entrance",
        "expected": "matched",
        "actual": "matched"
      },
      {
        "id": "L31",
        "feature": "first_line",
        "expected": "matched",
        "actual": "matched"
      }
    ]
  },
  "errors": [
    {
      "id": "L28",
      "query": "office-sale",
      "expected": "needs_review",
      "actual": "confirmed",
      "kind": "review_boundary",
      "url": "https://onrealt.ru/novosibirsk/kypit-ofis/86528532",
      "reason": "Апартаменты Port i7 с обещанием представительства: юридический статус не указан; не подтверждать офис и не выдумывать жилой статус.",
      "criteria": [
        {
          "criterion": "city",
          "state": "matched",
          "source": "structured",
          "evidence": "Новосибирск"
        },
        {
          "criterion": "operation",
          "state": "matched",
          "source": "structured",
          "evidence": "sale"
        },
        {
          "criterion": "purpose",
          "state": "matched",
          "source": "structured",
          "evidence": "office"
        },
        {
          "criterion": "priceUnit",
          "state": "matched",
          "source": "structured",
          "evidence": "rub_total"
        },
        {
          "criterion": "price",
          "state": "matched",
          "source": "structured",
          "evidence": "19000000.00 rub_total; rub_total"
        },
        {
          "criterion": "area",
          "state": "matched",
          "source": "structured",
          "evidence": "75.5"
        }
      ]
    },
    {
      "id": "L29",
      "query": "office-sale",
      "expected": "needs_review",
      "actual": "confirmed",
      "kind": "review_boundary",
      "url": "https://onrealt.ru/novosibirsk/kypit-ofis/86528560",
      "reason": "Прямо ПСН/мастерская, первый этаж, отдельный вход; офисное использование требует уточнения.",
      "criteria": [
        {
          "criterion": "city",
          "state": "matched",
          "source": "structured",
          "evidence": "Новосибирск"
        },
        {
          "criterion": "operation",
          "state": "matched",
          "source": "structured",
          "evidence": "sale"
        },
        {
          "criterion": "purpose",
          "state": "matched",
          "source": "structured",
          "evidence": "office"
        },
        {
          "criterion": "priceUnit",
          "state": "matched",
          "source": "structured",
          "evidence": "rub_total"
        },
        {
          "criterion": "price",
          "state": "matched",
          "source": "structured",
          "evidence": "10000000.00 rub_total; rub_total"
        },
        {
          "criterion": "area",
          "state": "matched",
          "source": "structured",
          "evidence": "92.8"
        }
      ]
    },
    {
      "id": "L35",
      "query": "office-sale",
      "expected": "needs_review",
      "actual": "confirmed",
      "kind": "review_boundary",
      "url": "https://onrealt.ru/novosibirsk/kypit-ofis/86529376",
      "reason": "Помещение в ЖК, обмен на нежилое не доказывает статус; этаж 14; требуется проверка.",
      "criteria": [
        {
          "criterion": "city",
          "state": "matched",
          "source": "structured",
          "evidence": "Новосибирск"
        },
        {
          "criterion": "operation",
          "state": "matched",
          "source": "structured",
          "evidence": "sale"
        },
        {
          "criterion": "purpose",
          "state": "matched",
          "source": "structured",
          "evidence": "office"
        },
        {
          "criterion": "priceUnit",
          "state": "matched",
          "source": "structured",
          "evidence": "rub_total"
        },
        {
          "criterion": "price",
          "state": "matched",
          "source": "structured",
          "evidence": "12500000.00 rub_total; rub_total"
        },
        {
          "criterion": "area",
          "state": "matched",
          "source": "structured",
          "evidence": "72"
        }
      ]
    },
    {
      "id": "L30",
      "query": "commercial-sale",
      "expected": "needs_review",
      "actual": "confirmed",
      "kind": "review_boundary",
      "url": "https://onrealt.ru/novosibirsk/kypit-ofis/86528614",
      "reason": "Отдельный вход только на согласовании, существование не подтверждено.",
      "criteria": [
        {
          "criterion": "city",
          "state": "matched",
          "source": "structured",
          "evidence": "Новосибирск"
        },
        {
          "criterion": "operation",
          "state": "matched",
          "source": "structured",
          "evidence": "sale"
        },
        {
          "criterion": "purpose",
          "state": "matched",
          "source": "structured",
          "evidence": "office"
        },
        {
          "criterion": "floor",
          "state": "matched",
          "source": "structured",
          "evidence": "1"
        },
        {
          "criterion": "отдельный вход",
          "source": "rule",
          "evidence": "Подготовлена документация для согласования отдельного входа",
          "state": "matched"
        }
      ]
    },
    {
      "id": "L48",
      "query": "commercial-sale",
      "expected": "rejected",
      "actual": "needs_review",
      "kind": "false_inclusion",
      "url": "https://realty.yandex.ru/offer/889555503400285658/",
      "reason": "Офис/коммерческое помещение; в описании этаж 19 против поля 1; город/единица цены отсутствуют.",
      "criteria": [
        {
          "criterion": "city",
          "state": "unknown",
          "source": "structured",
          "evidence": "Город неизвестен"
        },
        {
          "criterion": "operation",
          "state": "matched",
          "source": "rule",
          "evidence": "Арт. 138590882 Продается стильное коммерческое помещение с панорамным видом на город! Предлагаем к продаже светлое, просторное коммерческое помещение на 19 этаже, которое станет идеальным решением для современного офиса или любого бизнеса, где важны"
        },
        {
          "criterion": "purpose",
          "state": "matched",
          "source": "structured",
          "evidence": "office"
        },
        {
          "criterion": "floor",
          "state": "matched",
          "source": "structured",
          "evidence": "1"
        },
        {
          "criterion": "отдельный вход",
          "state": "unknown",
          "source": "rule",
          "evidence": "Нет подтверждающих сведений"
        }
      ]
    }
  ]
}
```
