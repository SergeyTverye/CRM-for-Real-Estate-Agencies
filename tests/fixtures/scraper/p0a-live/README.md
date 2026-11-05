# P0-A: обезличенные REPLAY живых страниц

Захвачено 2026-11-05 UTC / 06.11 Новосибирск, без AI и Web Search.
HTML сокращён до идентификатора объявления и фактической разметки/значений дат; контакты, продавцы, описания и фото удалены. Это REPLAY, не новые LIVE-запросы.

- `onrealt.html`: https://onrealt.ru/novosibirsk/kypit-ofis/86529013 — `.add-time`: «добавлено 17 августа в 15:07». Год выводится относительно fetchedAt, время Asia/Novosibirsk. Канонического link нет, привязка по `role-element=ad/id-element`.
- `yandex.html`: https://realty.yandex.ru/offer/1520155919935630221/ — проекция `window.INITIAL_STATE.card`: `offerId`, `creationDate`, `updateDate`. Даты агентства и других объявлений не используются.
- `mirkvartir.html`: https://cre.mirkvartir.ru/Новосибирская+область/Новосибирск/Офисы/ — `article` со ссылкой https://cre.mirkvartir.ru/371319585/ и `time[datetime]`. Нет подписи «публикация», поэтому только sourceUpdatedAt; publishedAt остаётся null.

Один GET навигации https://onrealt.ru/novosibirsk; из неё получены ссылки офиса/склада/ПСН и штатный обработчик `/core/send_form.php`. Его ответ для аренды торговли — `/novosibirsk/arenda-torgovyh-ploshchadej`, продажи — `/novosibirsk/kypit-torgovuyu-ploshchad`. Производство: `/arenda-proizvodstva`, `/kypit-proizvodstvo`. Один ECONNRESET у диагностического rent/production: один повтор через несколько минут, без загрузки выдачи. Дополнительно прочитаны два JS-ресурса навигации; они не дали маршрутов. Полнота рынка не заявляется.

Мир Квартир: HTTPS cre.mirkvartir.ru, ответ 200, `Content-Encoding: gzip` вопреки identity. TLS-проверки не отключались. Адаптер распаковывает gzip/deflate/br с ограничением wire/decoded размера, DNS/IP guard, pinning и проверкой каждого redirect. Ограниченный рабочий LIVE подтвердил нормализацию 25 офисных карточек.
