"""Собирает отчёт и альбом из документационных источников без сетевых обращений."""

from pathlib import Path
from io import BytesIO
import argparse
import hashlib
import html
import json
import re
import shutil
import subprocess
import sys

from PIL import Image as PILImage, ImageDraw, ImageFont
from pypdf import PdfReader
import pdfplumber
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, PageBreak,
    LongTable, TableStyle, Flowable, KeepTogether,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'docs/thesis'
TEMP = ROOT / 'tmp/pdfs/thesis'
BLUE = colors.HexColor('#174979')
INK = colors.HexColor('#172939')
MUTED = colors.HexColor('#526578')
PALE = colors.HexColor('#edf3f8')
ALBUM = DEST / 'CRM-screenshots-v3.2.3.pdf'
REPORT = DEST / 'CRM-v3.2.3-отчёт-о-тестировании.pdf'
MD = DEST / 'v323-comprehensive-report.md'


def fonts(directory):
    for name, file in [('Arial', 'arial.ttf'), ('Arial-Bold', 'arialbd.ttf'),
                       ('Arial-Italic', 'ariali.ttf')]:
        pdfmetrics.registerFont(TTFont(name, str(directory / file)))
    pdfmetrics.registerFontFamily('Arial', normal='Arial', bold='Arial-Bold',
                                  italic='Arial-Italic', boldItalic='Arial-Bold')


def markup(value):
    value = value.replace('\u2011', '-').replace('\u00a0', ' ')
    value = html.escape(value)
    value = re.sub(r'\[([^\]]+)\]\((https?://[^)]+)\)',
                   r'<link href="\2" color="#174979">\1</link>', value)
    value = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', value)
    return re.sub(r'`([^`]+)`', r'\1', value)


def style(name, **kwargs):
    return ParagraphStyle(name, fontName='Arial', textColor=INK,
                          fontSize=10, leading=14.5, **kwargs)


BODY = style('body', spaceAfter=8)
H1 = style('h1', spaceBefore=16, spaceAfter=10, keepWithNext=True)
H1.fontName = 'Arial-Bold'
H1.fontSize = 16
H1.leading = 20
H2 = style('h2', spaceBefore=10, spaceAfter=7, keepWithNext=True)
H2.fontName = 'Arial-Bold'
H2.fontSize = 12
H2.leading = 17
CELL = style('cell')
CELL.fontSize = 8.4
CELL.leading = 11.5
SMALL = style('small', spaceAfter=6)
SMALL.fontSize = 8
SMALL.leading = 11
TITLE = style('title', alignment=TA_CENTER)
TITLE.fontName = 'Arial-Bold'
TITLE.fontSize = 26
TITLE.leading = 34


def paragraph(text, kind=BODY):
    return Paragraph(markup(text), kind)


SEARCH_CAPTIONS = {
    'e2e-ai-locations': 'AI-разбор склада у Оби: черновик локации и параметров перед подтверждением, исходный e2e-срез',
    'e2e-ai-multiple-locations': 'AI-разбор нескольких локаций: склад от 300 м², Обь и Новосибирск, подтверждение пользователя',
    'e2e-card-cian': 'Карточки с данными Циана и других площадок: исключения по локации, цена и причина вердикта',
    'e2e-card-onrealt': 'Карточка OnRealt: офис, известная площадь и адрес, неизвестный период цены, требуется проверка',
    'e2e-card-yandex': 'Карточка Яндекса без адреса: неизвестные поля явно показаны, соответствие не подтверждено',
    'e2e-filter-locations': 'Ручная форма поиска: выбор населённых пунктов, типов объектов и площадок',
    'e2e-manual-avito-domclick': 'Состояния площадок: Авито требует действия, Домклик заблокирован, доступны ручные пути',
    'e2e-manual-avito': 'Авито: открыт диалог добавления по ссылке, объявление не добавлялось, блокировка не обходилась',
    'e2e-manual-domclick': 'Домклик: диалог ручного добавления по ссылке поверх частичной выдачи CRM',
    'e2e-ranking': 'LIVE-ранжирование двух выбранных объявлений: рекомендация отделена от фактов и требует проверки',
    'e2e-scenario-a-cards': 'Сценарий a: аренда офиса 50–100 м² в Академгородке, неизвестный период цены требует проверки',
    'e2e-scenario-b-cards': 'Сценарий b до фильтра комнат: квартиры в Бердске до 5 млн, в выборке также студии и однокомнатные',
    'e2e-scenario-c-cards': 'Сценарий c: склады от 300 м² в Оби и Новосибирске, адреса и периоды цены известны не у всех',
    'e2e-scenario-d-cards': 'Сценарий d: квартиры в аренду в Кольцово, неизвестный период не подтверждает месячную ставку',
    'e2e-scenario-e-cards': 'Сценарий e: продажа домов и коттеджей в области, в карточках видны адреса, цены и вердикты',
    'e2e-scenario-f-cards': 'Сценарий f исходного e2e-среза: поиск апартаментов, неизвестный тип требует проверки',
    'e2e-scenario-g-cards': 'Сценарий g: нежилые помещения в городе и пригородах, неизвестный период цены требует проверки бюджета',
    'e2e-sources-results': 'Панель семи источников: результаты успешных площадок сохранены рядом с blocked и needs_user_action',
    'flat-berdsk': 'Ранняя географическая проверка: форма продажи квартиры в Бердске, заданные условия поиска',
    'flat-berdsk-results': 'Сохранённый LIVE-запуск Бердска в режиме REPLAY: пять карточек, отдельные вердикты результата',
    'office-akademgorodok': 'Ранняя географическая проверка: офис 50–100 м², Академгородок обозначен Советским районом',
    'office-akademgorodok-results': 'Сохранённая выдача Академгородка: статус источника не означает совпадение по району и площади',
    'quality-filter-locations': 'После quality-изменений: явный выбор локаций и фильтров без скрытого расширения города',
    'quality-room-filter': 'После исправления: выбран фильтр двух комнат для продажи квартиры в Бердске до 5 млн',
    'quality-room-results': 'Результаты с фильтром комнат: подтверждённые и требующие проверки карточки разделены',
    'warehouse-ob': 'Ранняя форма поиска: аренда склада в городе Обь, выбран отдельный населённый пункт',
    'warehouse-ob-results': 'Сохранённый LIVE-запуск склада у Оби: частичный результат после тайм-аута, не доказательство пустого рынка',
}

CAPTION_CORRECTIONS = {
    ('server', '01-login-form.png'): 'Экран «Сегодня» после входа руководителя, исходный файл назван login-form, но формы входа в кадре нет',
    ('server', '04-requests-list.png'): 'Карточка клиента после регистрации обращения: потребность, следующее действие и контакт, список обращений в кадре не показан',
    ('server', '07-need-matching.png'): 'Подбор по потребности: открыта вкладка предложенных объектов, список пока пуст',
    ('server', '17-deals-list.png'): 'Экран «Сделки»: табличный список с фильтрами, статусами, суммами и датами',
    ('desktop', '16-deals-list.png'): 'Экран «Сделки»: табличный список с фильтрами, статусами, суммами и датами',
    ('server', '29-ai-search.png'): 'AI-помощник поверх экрана поиска объектов: общий диалог и уточнение контекста, не отдельная форма AI-разбора условий',
    ('server', '32-rbac-search.png'): 'Отказ доступа «Запись не найдена или недоступна», исходное имя rbac-search, глобальная поисковая выдача в кадре отсутствует',
    ('server', '33-archive.png'): 'Исторический архив: экран «Нет доступа» для пользователя без разрешения',
    ('desktop', '30-archive.png'): 'Исторический архив: экран «Нет доступа» для пользователя без разрешения',
}


def collect_images():
    entries = []
    for section, folder, mode in [
        ('Серверная версия', 'server', 'QA / PostgreSQL / синтетические данные'),
        ('Десктопная версия', 'desktop', 'QA / SQLite / supervisor без окна Tauri'),
    ]:
        directory = DEST / 'screenshots' / folder
        captions = json.loads((directory / 'captions.json').read_text(encoding='utf-8'))
        listed = set()
        for item in captions:
            path = directory / item['file']
            if not path.is_file():
                raise FileNotFoundError(path)
            listed.add(path.name)
            caption = CAPTION_CORRECTIONS.get((folder, path.name), item['caption'])
            entries.append(dict(section=section, path=path, caption=caption, mode=mode))
        if listed != {p.name for p in directory.glob('*.png')}:
            raise ValueError(f'Не все снимки перечислены в {directory}')
    search = ROOT / 'docs/screenshots/vkr/v323-search'
    for path in sorted(search.glob('*.png')):
        caption = SEARCH_CAPTIONS[path.stem]
        mode = 'Форма / проверка интерфейса'
        if 'result' in path.stem or 'cards' in path.stem or 'card-' in path.stem or 'manual' in path.stem:
            mode = 'Сохранённые LIVE-результаты / повторное открытие'
        if 'ranking' in path.stem or 'ai-' in path.stem:
            mode = 'LIVE AI / синтетический CRM-контекст'
        entries.append(dict(section='Поиск недвижимости', path=path, caption=caption, mode=mode))
    for path in sorted((ROOT / 'docs/screenshots/vkr/v323-captcha').glob('*.png')):
        captions = {
            'avito-blocked': 'Авито: страница отказа HTTP 403 в обычном Chromium, выдача не получена',
            'cian-blocked': 'Циан: подозрительный трафик и отказ headless-пробы, исторический кадр до успеха native headed',
            'domclick-blocked': 'Домклик: страница отказа, запрос заблокирован HTTP 401, ручной путь сохраняется',
        }
        entries.append(dict(section='Поиск недвижимости', path=path,
                            caption=captions[path.stem], mode='LIVE / зафиксированная блокировка'))
    for path in sorted((ROOT / 'docs/screenshots/vkr/v323-assistant').glob('*.png')):
        screen = {'01': 'клиента', '02': 'потребности', '03': 'задачи', '04': 'сделки'}[path.name[:2]]
        demo = '-demo' in path.stem
        mode = 'DEMO / fake provider' if demo else 'LIVE AI / v1' if path.name.startswith('01') else 'LIVE AI / v2'
        caption = (f'Контекстный помощник в карточке {screen}: ' +
                   ('демонстрационный ответ fake-провайдера, не результат внешней модели' if demo else
                    'реальный ответ на обезличенный контекст, действия требуют подтверждения'))
        entries.append(dict(section='AI-помощник', path=path, caption=caption, mode=mode))
    pairs = [
        ('manager-task-new-1366x768.png', 'Новая задача', 'шаблоны, повторения и связи занимают основной экран',
         'редкие параметры свёрнуты, кнопка создания доступна в первом экране'),
        ('manager-clients-1366x768.png', 'Список клиентов', 'переход к истории через карточку клиента',
         'история и потребности доступны из строки, до отдельной правки переноса телефона'),
        ('realtor1-need-edit-1920x1080.png', 'Изменение потребности', 'финансирование и дополнительные требования раскрыты',
         'редкие параметры выделены в раскрываемые разделы, основные поля компактнее'),
    ]
    for name, title, before, after in pairs:
        for state, desc in [('before', before), ('after', after)]:
            path = ROOT / 'docs/screenshots/vkr/v322-ux' / state / name
            label = 'ДО / 6ee543c' if state == 'before' else 'ПОСЛЕ / d881253'
            entries.append(dict(section='UX до/после', path=path,
                                caption=f'{title}: {desc}', mode=f'Историческая пара v3.2.2 / {label}'))
    return entries


def draw_para(c, text, x, y, width, ps=BODY):
    p = paragraph(text, ps)
    _, height = p.wrap(width, 800)
    p.drawOn(c, x, y - height)
    return height


def album_footer(c, page, total, width):
    c.setStrokeColor(colors.HexColor('#cdd7df'))
    c.line(36, 29, width - 36, 29)
    c.setFont('Arial', 8)
    c.setFillColor(MUTED)
    c.drawString(36, 17, 'CRM v3.2.3 | Альбом иллюстраций | 09.11.2026')
    c.drawRightString(width - 36, 17, f'{page} / {total}')


def build_album(entries):
    width, height = landscape(A4)
    total = len(entries) + 2
    c = canvas.Canvas(str(ALBUM), pagesize=(width, height), pageCompression=1)
    c.setTitle('CRM v3.2.3. Альбом иллюстраций тестирования')
    c.setAuthor('Проект CRM для агентства недвижимости')
    c.setFillColor(BLUE)
    c.rect(0, height - 16, width, 16, fill=1, stroke=0)
    draw_para(c, 'CRM для агентства недвижимости', 80, height - 120, width - 160, TITLE)
    draw_para(c, 'Альбом иллюстраций тестирования\n'.strip(), 80, height - 180, width - 160,
              style('subtitle', alignment=TA_CENTER))
    draw_para(c, 'v3.2.3 · Материал для магистерской диссертации', 80, height - 216, width - 160,
              style('version', alignment=TA_CENTER))
    draw_para(c, f'{len(entries)} рисунков · сервер / десктоп / поиск / AI / UX', 80, height - 255,
              width - 160, style('count', alignment=TA_CENTER))
    draw_para(c, 'Срез: 9 ноября 2026 года. Все CRM-карточки относятся к синтетическим стендам. '
              'Снимки площадок фиксируют ограниченные публичные проверки. LIVE, сохранённые '
              'результаты, DEMO и исторические пары подписаны отдельно. Desktop QA выполнен '
              'через supervisor, без окна Tauri. Один кадр на странице, масштабирование без обрезки.',
              130, 245, width - 260)
    album_footer(c, 1, total, width)
    c.showPage()
    draw_para(c, 'Оглавление', 42, height - 42, width - 84, H1)
    groups = []
    for i, item in enumerate(entries):
        if not groups or groups[-1][0] != item['section']:
            groups.append((item['section'], i + 3, i + 1))
    y = height - 110
    for index, (section, page, figure) in enumerate(groups):
        next_page = groups[index + 1][1] - 1 if index + 1 < len(groups) else total
        draw_para(c, f'{section} · страницы {page}–{next_page} · с рисунка {figure}',
                  64, y, width - 128)
        c.linkRect('', f'section-{index}', (60, y - 20, width - 60, y + 5), relative=0, thickness=0)
        y -= 43
    draw_para(c, 'В каждой подписи указан исходный путь PNG. Изображения встроены как JPEG '
              'с качеством 85, ширина не более 2000 px, исходные файлы сохранены без изменений. '
              'В PDF доступно увеличение для чтения мелких деталей интерфейса. '
              'Кадр сам по себе иллюстрирует состояние, статус сценария следует сверять с отчётом QA.',
              64, y - 15, width - 128, SMALL)
    album_footer(c, 2, total, width)
    c.showPage()
    group_index = {p: i for i, (_, p, _) in enumerate(groups)}
    manifest = []
    for n, item in enumerate(entries, 1):
        page = n + 2
        if page in group_index:
            key = f'section-{group_index[page]}'
            c.bookmarkPage(key)
            c.addOutlineEntry(item['section'], key, 0)
        draw_para(c, item['section'], 36, height - 25, width - 72, H2)
        c.setFont('Arial', 8)
        c.setFillColor(MUTED)
        c.drawRightString(width - 36, height - 28, item['mode'])
        im = PILImage.open(item['path']).convert('RGB')
        im.thumbnail((2000, 10000), PILImage.Resampling.LANCZOS)
        data = BytesIO()
        im.save(data, format='JPEG', quality=85, optimize=True)
        data.seek(0)
        caption = f'Рисунок {n}. {item["caption"]}.'
        caption_style = style('caption')
        caption_style.fontSize = 10
        caption_style.leading = 13
        p = paragraph(caption, caption_style)
        _, cap_height = p.wrap(width - 72, 200)
        bottom = 78 + cap_height
        available = height - 61 - bottom
        scale = min((width - 72) / im.width, available / im.height)
        iw, ih = im.width * scale, im.height * scale
        x, y = (width - iw) / 2, bottom + (available - ih) / 2
        c.setStrokeColor(colors.HexColor('#d5dde5'))
        c.rect(x - 0.5, y - 0.5, iw + 1, ih + 1, fill=0, stroke=1)
        c.drawImage(ImageReader(data), x, y, iw, ih)
        p.drawOn(c, 36, 65)
        rel = item['path'].relative_to(ROOT).as_posix()
        draw_para(c, f'Источник: {rel}', 36, 53, width - 72, SMALL)
        album_footer(c, page, total, width)
        c.showPage()
        manifest.append(dict(figure=n, page=page, section=item['section'], source=rel,
                             mode=item['mode'], caption=item['caption'],
                             source_sha256=hashlib.sha256(item['path'].read_bytes()).hexdigest()))
    c.save()
    if ALBUM.stat().st_size > 60 * 1024 * 1024:
        raise ValueError('Альбом превышает 60 МБ')
    (DEST / 'v323-album-manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


class Architecture(Flowable):
    """Рисует эквивалент Mermaid средствами векторной графики PDF."""

    def __init__(self, width):
        super().__init__()
        self.width = width
        self.height = 310

    def draw(self):
        c = self.canv
        w = self.width

        def box(x, y, bw, bh, text):
            c.setFillColor(PALE)
            c.setStrokeColor(colors.HexColor('#9fb6cb'))
            c.roundRect(x, y, bw, bh, 5, fill=1, stroke=1)
            ps = style('diagram', alignment=TA_CENTER)
            ps.fontSize = 8.6
            ps.leading = 12
            p = paragraph(text, ps)
            _, h = p.wrap(bw - 10, bh)
            p.drawOn(c, x + 5, y + (bh - h) / 2)

        def arrow(x1, y1, x2, y2):
            c.setStrokeColor(BLUE)
            c.line(x1, y1, x2, y2)
            c.line(x2, y2, x2 - 3, y2 + 5)
            c.line(x2, y2, x2 + 3, y2 + 5)

        box(0, 264, w * .47, 36, 'Браузер / серверный режим')
        box(w * .53, 264, w * .47, 36, 'Tauri 2 / локальный WebView')
        box(w * .16, 204, w * .68, 42, 'Next.js UI · API /api/v1 · application')
        arrow(w * .23, 264, w * .33, 246)
        arrow(w * .77, 264, w * .67, 246)
        box(w * .16, 148, w * .68, 38, 'RBAC · доменные правила · транзакции')
        arrow(w * .5, 204, w * .5, 186)
        box(0, 81, w * .28, 44, 'Prisma / диалект\nPostgreSQL или SQLite')
        box(w * .31, 81, w * .31, 44, 'StorageAdapter\nФайлы вне БД / backup')
        box(w * .65, 81, w * .35, 44, 'AI gate / privacy\nYandex / fake provider')
        for end in [.14, .46, .82]:
            arrow(w * .5, 148, w * end, 125)
        box(0, 8, w * .46, 48, 'Supervisor desktop / процессы Compose\nВоркеры уведомлений и поиска')
        box(w * .52, 8, w * .48, 48, 'ScraperAdapter / HTTP / Chromium / HITL\nВнешние площадки')
        c.setStrokeColor(BLUE)
        c.line(w * .46, 32, w * .52, 32)


class ReportDoc(BaseDocTemplate):
    def __init__(self, filename):
        super().__init__(str(filename), pagesize=A4, leftMargin=46, rightMargin=46,
                         topMargin=48, bottomMargin=46, pageCompression=1,
                         title='CRM v3.2.3. Комплексный отчёт о тестировании',
                         author='Проект CRM для агентства недвижимости')
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height,
                      leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates(PageTemplate(id='report', frames=frame, onPage=self.decor))

    def decor(self, c, doc):
        c.saveState()
        c.setFillColor(MUTED)
        c.setFont('Arial', 8)
        c.drawString(46, A4[1] - 28, 'CRM v3.2.3 | Тестирование и развитие')
        c.drawRightString(A4[0] - 46, A4[1] - 28, '09.11.2026')
        c.setStrokeColor(colors.HexColor('#cdd7df'))
        c.line(46, 33, A4[0] - 46, 33)
        c.drawString(46, 21, 'Материал для магистерской диссертации')
        c.drawRightString(A4[0] - 46, 21, str(doc.page))
        c.restoreState()

    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and flowable.style.name == 'h1':
            text = flowable.getPlainText()
            key = 'report-' + hashlib.sha256(text.encode()).hexdigest()[:12]
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(text, key, 0)
            self.notify('TOCEntry', (0, text, self.page, key))


def table_flow(lines, width):
    rows = []
    for line in lines:
        cells = [x.strip() for x in line.strip().strip('|').split('|')]
        if all(re.fullmatch(r'[:\- ]+', x or '-') for x in cells):
            continue
        rows.append(cells)
    n = len(rows[0])
    if any(len(row) != n for row in rows):
        raise ValueError('Неверное число колонок таблицы')
    if rows[0][0] == 'ID':
        weights = [.07, .58, .35]
    elif n == 5:
        weights = [.23, .19, .19, .19, .20]
    elif n == 4:
        weights = [.30, .21, .21, .28]
    elif n == 3:
        weights = [.30, .35, .35]
    else:
        weights = [1 / n] * n
    values = [[paragraph(value, CELL) for value in row] for row in rows]
    table = LongTable(values, colWidths=[width * v for v in weights], repeatRows=1, hAlign='LEFT')
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), PALE),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LINEBELOW', (0, 0), (-1, 0), .8, colors.HexColor('#8fa8bc')),
        ('LINEBELOW', (0, 1), (-1, -1), .3, colors.HexColor('#dbe2e8')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f8fafc')]),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    return table


def build_report():
    doc = ReportDoc(REPORT)
    story = [Spacer(1, 105), paragraph('CRM для агентства недвижимости', TITLE),
             Spacer(1, 30), paragraph('Комплексный отчёт о тестировании и развитии', TITLE),
             Spacer(1, 25), paragraph('v3.2.3 · Материал для магистерской диссертации', BODY),
             Spacer(1, 32), paragraph('Две модели развёртывания · PostgreSQL и SQLite · '
             'бизнес-сценарии · поиск недвижимости · AI · безопасность · восстановление', BODY),
             Spacer(1, 26), paragraph('Срез доказательств: 9 ноября 2026 года. '
             'Окончательные результаты интеграционной регрессии фиксируются координатором '
             'в docs/acceptance/v323/README.md.', BODY), PageBreak(), paragraph('Оглавление', H2)]
    toc = TableOfContents()
    ts = style('toc', spaceBefore=7)
    ts.fontSize = 10
    ts.leading = 15
    toc.levelStyles = [ts]
    story.extend([toc, PageBreak()])
    lines = MD.read_text(encoding='utf-8').splitlines()
    i = 1
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if line.startswith('```mermaid'):
            i += 1
            while i < len(lines) and not lines[i].startswith('```'):
                i += 1
            story.append(Architecture(doc.width))
            i += 1
            continue
        if line.startswith('|'):
            block = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                block.append(lines[i])
                i += 1
            story.extend([table_flow(block, doc.width), Spacer(1, 10)])
            continue
        if line.startswith('## '):
            story.append(paragraph(line[3:], H1))
            i += 1
            continue
        if line.startswith('### '):
            story.append(paragraph(line[4:], H2))
            i += 1
            continue
        block = [line]
        i += 1
        while i < len(lines) and lines[i].strip() and not lines[i].startswith(('#', '|', '```')):
            if re.match(r'^\d+\. ', lines[i]):
                break
            block.append(lines[i].strip())
            i += 1
        p = paragraph(' '.join(block))
        story.append(KeepTogether([p]) if re.match(r'^\d+\. ', line) else p)
    doc.multiBuild(story)


def validate():
    result = {}
    for name, path in [('album', ALBUM), ('report', REPORT)]:
        reader = PdfReader(path)
        texts = [page.extract_text() or '' for page in reader.pages]
        if any(len(t.strip()) < 45 for t in texts):
            raise ValueError(f'Пустая страница в {name}')
        if any('\ufffd' in t or '\u25a0' in t for t in texts):
            raise ValueError(f'Повреждённые символы в {name}')
        destinations = []
        for annotation in reader.pages[1].get('/Annots', []):
            target = annotation.get_object().get('/Dest')
            if target:
                number = reader.get_page_number(target[0].get_object())
                if number < 2 or number >= len(reader.pages):
                    raise ValueError('Неверная ссылка оглавления')
                destinations.append(number)
        expected_sections = 5 if name == 'album' else 14
        if len(reader.outline) != expected_sections:
            raise ValueError('Неверное число разделов в закладках')
        if len(destinations) != expected_sections * (1 if name == 'album' else 2):
            raise ValueError('Неверное число ссылок оглавления')
        if name == 'album':
            for number, text in enumerate(texts[2:], 1):
                if f'Рисунок {number}.' not in text:
                    raise ValueError('Неверная нумерация рисунков')
        with pdfplumber.open(path) as pdf:
            for number, page in enumerate(pdf.pages, 1):
                for char in page.chars:
                    if char['x0'] < -1 or char['x1'] > page.width + 1:
                        raise ValueError(f'Текст вне ширины страницы {name}/{number}')
                    if char['top'] < -1 or char['bottom'] > page.height + 1:
                        raise ValueError(f'Текст вне высоты страницы {name}/{number}')
                if name == 'album' and number > 2 and len(page.images) != 1:
                    raise ValueError(f'Неверное число изображений на странице {number}')
        for page in reader.pages:
            resources = page['/Resources'].get_object()
            for font in resources.get('/Font', {}).get_object().values():
                obj = font.get_object()
                if obj.get('/Subtype') == '/TrueType':
                    descriptor = obj['/FontDescriptor'].get_object()
                    if '/FontFile2' not in descriptor:
                        raise ValueError('Шрифт не встроен')
        result[name] = dict(file=path.name, pages=len(reader.pages), bytes=path.stat().st_size,
                            sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                            outline_sections=len(reader.outline), contents_links=len(destinations))
    text = '\n'.join((p.extract_text() or '') for p in PdfReader(REPORT).pages)
    for required in ['Итоговая регрессия', '2161', '446', '42560441228', '1,417400', 'maxChunks']:
        if required not in text:
            raise ValueError(f'Текст отсутствует в отчёте: {required}')
    result['figures'] = len(json.loads((DEST / 'v323-album-manifest.json').read_text(encoding='utf-8')))
    result['report_figures'] = 1
    result['report_source_sha256'] = hashlib.sha256(MD.read_bytes()).hexdigest()
    result['checks'] = ['no_blank_pages', 'no_missing_glyphs', 'text_within_pages',
                        'one_image_per_album_page', 'embedded_truetype_fonts', 'required_regression_text',
                        'contents_destinations', 'figure_numbers']
    (DEST / 'v323-pdf-build.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False, indent=2))


def render(names=None):
    poppler = shutil.which('pdftoppm')
    if not poppler:
        raise RuntimeError('Не найден pdftoppm')
    for name, path in [('album', ALBUM), ('report', REPORT)]:
        if names and name not in names:
            continue
        folder = TEMP / name
        folder.mkdir(parents=True, exist_ok=True)
        subprocess.run([poppler, '-r', '85', '-png', str(path), str(folder / 'page')], check=True)
        pages = sorted(folder.glob('page-*.png'))
        fnt = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 17)
        for start in range(0, len(pages), 6):
            sheet = PILImage.new('RGB', (1500, 1260), '#d9e2ea')
            draw = ImageDraw.Draw(sheet)
            for j, file in enumerate(pages[start:start + 6]):
                im = PILImage.open(file).convert('RGB')
                im.thumbnail((740, 380), PILImage.Resampling.LANCZOS)
                x = (j % 2) * 750
                y = (j // 2) * 420
                sheet.paste(im, (x + (750 - im.width) // 2, y + 30))
                draw.text((x + 10, y + 4), f'{name} / {file.stem}', font=fnt, fill='black')
            sheet.save(folder / f'contact-{start // 6 + 1:02}.jpg', quality=90)
        print(f'{name}: {len(pages)} PNG, {(len(pages) + 5) // 6} обзорных листов, {folder}')


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--render', action='store_true')
    parser.add_argument('--check-only', action='store_true')
    parser.add_argument('--render-only', action='store_true')
    parser.add_argument('--report-only', action='store_true')
    parser.add_argument('--font-dir', type=Path, default=Path('C:/Windows/Fonts'))
    args = parser.parse_args()
    DEST.mkdir(parents=True, exist_ok=True)
    TEMP.mkdir(parents=True, exist_ok=True)
    fonts(args.font_dir)
    if not args.check_only and not args.render_only:
        if not args.report_only:
            entries = collect_images()
            build_album(entries)
        build_report()
    validate()
    if args.render or args.render_only:
        render(['report'] if args.report_only else None)


if __name__ == '__main__':
    main()
