"""Build the editable Markdown guide as a bookmarked, linked A4 PDF.

Python 3.12.14 + reportlab 4.4.9 + Pillow 13.0.0 (bundled Python runtime).
Usage: python scripts/docs/build-user-guide.py [--render]
Fonts: Windows Arial, or --font-dir containing arial.ttf/arialbd.ttf/ariali.ttf.
The parser deliberately supports only headings, paragraphs, numbered steps,
bold text and Markdown figures. It fails on missing images and page overflow.
"""
from pathlib import Path
import argparse
import html
import json
import os
import re
import subprocess
import sys
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, Image
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor, white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from PIL import Image as PILImage, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
VERSION = 'v3.2.2'
DEST = ROOT / 'docs/user-guide' / VERSION
TMP = ROOT / 'tmp/pdfs/guide'
BLUE = '#1559A6'


def markup(text):
    return re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', html.escape(text))


def annotate(source, target, crop=None, boxes=()):
    im = PILImage.open(source).convert('RGB')
    if crop:
        im = im.crop(crop)
    draw = ImageDraw.Draw(im)
    unit = max(1, im.width / 1400)
    font = ImageFont.truetype(str(FONTS / 'arialbd.ttf'), round(24 * unit))
    for n, (x, y, w, h) in enumerate(boxes, 1):
        x, y, w, h = x * im.width, y * im.height, w * im.width, h * im.height
        draw.rounded_rectangle((x, y, x+w, y+h), radius=5*unit,
                               outline=BLUE, width=max(3, round(4*unit)))
        r = 18 * unit
        cx, cy = max(r, x), max(r, y)
        draw.ellipse((cx-r, cy-r, cx+r, cy+r), fill=BLUE, outline='white', width=2)
        draw.text((cx, cy), str(n), font=font, fill='white', anchor='mm')
    im.save(target, optimize=True)


def prepare_images():
    images = DEST / 'images'
    legacy = ROOT / 'docs/screenshots/vkr'
    evidence = []
    specs = [
        ('install', 'v32-desktop-clients-demo.png', None, [(0.005,.09,.16,.84),(.19,.265,.79,.38)]),
        ('local-state','v32-desktop-backups-demo.png',(255,95,1407,593),[(.01,.16,.98,.56),(.01,.88,.98,.1)]),
        ('backup','v32-desktop-backups-demo.png',(255,460,1407,1145),[(.01,.12,.98,.07),(.01,.2,.98,.78)]),
        ('clouds','v32-desktop-backups-demo.png',(261,594,1407,917),[(.005,.02,.485,.95),(.5,.02,.49,.95)]),
        ('usb','v32-desktop-backups-demo.png',(261,917,1407,1145),[(.005,.02,.485,.95),(.5,.02,.49,.95)]),
        ('schedule','v32-desktop-backup-schedule-demo.png',(421,0,987,690),[(.025,.09,.95,.81),(.025,.91,.34,.06)]),
        ('excel','v32-installed-9ffc2c40-5f70-4768-8cef-8f379b7acb1d-synthetic-import-roundtrip.png',(260,87,1426,811),[(.01,.1,.98,.87)]),
    ]
    for name, file, crop, boxes in specs:
        annotate(legacy/file, images/f'{name}.png', crop, boxes)
        evidence.append({'file':f'{name}.png', 'source':str((legacy/file).relative_to(ROOT)), 'kind':'historical synthetic desktop', 'crop':crop, 'boxes':boxes})
    liveboxes = {
        'today':[(.004,.09,.16,.88),(.18,.005,.81,.075),(.18,.17,.81,.78)],
        'clients':[(.18,.095,.81,.18),(.18,.28,.81,.50)],
        'request-new':[(.18,.2,.64,.38),(.18,.6,.64,.35)],
        'needs':[(.18,.1,.81,.2),(.18,.31,.81,.56)],
        'search':[(.18,.09,.81,.15),(.18,.26,.81,.48),(.18,.76,.81,.15)],
        'collections':[(.18,.095,.81,.11),(.18,.22,.81,.55)],
        'offers':[(.18,.095,.81,.11),(.18,.22,.81,.55)],
        'tasks':[(.18,.095,.81,.2),(.18,.31,.81,.57)],
        'calendar':[(.18,.1,.81,.23),(.18,.35,.81,.62)],
        'agreement-new':[(.18,.1,.81,.22),(.18,.34,.81,.48)],
        'import':[(.18,.1,.81,.5),(.18,.63,.81,.32)],
    }
    historical={
        'today':'v322-ux/after/realtor1-today-1366x768.png',
        'clients':'v322-ux/after/realtor1-clients-1366x768.png',
        'request-new':'v322-ux/after/realtor1-request-new-1366x768.png',
        'needs':'v322-ux/after/realtor1-needs-1366x768.png',
        'search':'v32-search-primary.png',
        'collections':'v322-ux/after/realtor1-collections-1366x768.png',
        'offers':'v322-ux/after/realtor1-offers-1366x768.png',
        'tasks':'v322-ux/after/realtor1-tasks-1366x768.png',
        'calendar':'v322-ux/after/realtor1-planner-1366x768.png',
        'agreement-new':'v322-ux/after/manager-agreements-expiring-1366x768.png',
        'import':'v32-installed-9ffc2c40-5f70-4768-8cef-8f379b7acb1d-synthetic-import-roundtrip.png',
    }
    captured=(images/'capture-manifest.json').exists()
    for name, boxes in liveboxes.items():
        source=images/f'{name}-raw.png' if captured else legacy/historical[name]
        fresh_name={'search':'search-expanded'}.get(name,name)
        fresh=images/'live'/f'{fresh_name}.png'
        sidecar=images/'live'/f'{fresh_name}.json'
        is_fresh=fresh.exists() and sidecar.exists()
        if is_fresh:
            source=fresh
        if not source.exists(): raise FileNotFoundError(source)
        annotate(source,images/f'{name}.png',boxes=boxes)
        evidence.append({'file':f'{name}.png','source':str(source.relative_to(ROOT)),
                         'kind':'fresh synthetic demo' if captured or is_fresh else 'archived synthetic screenshot',
                         'boxes':boxes})
    extra_specs = [
        ('login','live/login.png',(1030,550,1850,1250),[(.02,.02,.96,.96)]),
        ('saved-searches','live/saved-searches.png',(530,1030,2835,1760),[(.01,.01,.98,.98)]),
        ('search-advanced','live/search-advanced.png',None,[(.18,.13,.8,.8)]),
        ('search-collapsed','live/search-collapsed.png',(530,330,2840,1010),[(.01,.01,.98,.98)]),
        ('agreement-files','live/agreement-files.png',(550,930,2330,1790),[(.01,.01,.98,.98)]),
        ('agreement-retry','live/agreement-upload-retry.png',(550,390,2320,675),[(.01,.01,.98,.98)]),
        ('agreement-documents','live/agreement-documents.png',(530,1360,2840,1755),[(.01,.01,.98,.98)]),
        ('notifications','live/notifications.png',(530,200,2840,990),[(.01,.01,.98,.98)]),
        ('ai-settings','live/ai-settings.png',(530,185,2840,1500),[(.01,.01,.98,.32),(.01,.34,.98,.64)]),
        ('search-sources','live/search-sources.png',(530,185,2840,1650),[(.01,.1,.98,.35),(.01,.48,.98,.5)]),
        ('backup-settings','live/backup-settings.png',(530,185,2840,1300),[(.01,.1,.98,.58),(.01,.7,.98,.28)]),
        ('result-cards','live/search-results-live.png',(530,160,2680,1536),[]),
        ('result-table','../../../../vkr/live-search-v322-p0c-table.png',(145,315,1221,1065),[(.01,.01,.98,.4),(.01,.47,.98,.52)]),
        ('ranking','live/ranking-success.png',(560,850,2670,1510),[]),
        ('comparison','../../../../screenshots/vkr/v322-search-ai/retest-01-comparison.png',(280,300,1328,675),[(.01,.01,.98,.98)]),
    ]
    for name,relative,crop,boxes in extra_specs:
        source=(images/relative).resolve()
        
        if relative.startswith('../../../../'):
            source=ROOT/'docs'/relative.removeprefix('../../../../')
        if not source.exists() and (images/f'{name}.png').exists():
            evidence.append({'file':f'{name}.png','source':str((images/f'{name}.png').relative_to(ROOT)),
                'kind':'retained tracked illustration; original capture unavailable in checkout',
                'privacyReview':'Previously reviewed illustration retained without recropping'})
            continue
        annotate(source,images/f'{name}.png',crop,boxes)
        evidence.append({'file':f'{name}.png','source':str(source.relative_to(ROOT)),
            'kind':'coordinator capture' if relative.startswith('live/') else 'prior LIVE UI / P0-C synthetic component',
            'crop':crop,'boxes':boxes,'privacyReview':'No secrets or seller contacts visible in selected area'})
    if VERSION == 'v3.2.3':
        for name in ['e2e-filter-locations','e2e-sources-results','e2e-ai-locations','e2e-ranking','e2e-manual-domclick','quality-room-filter','quality-room-results']:
            source=legacy/'v323-search'/f'{name}.png'
            annotate(source,images/f'{name}.png')
            evidence.append({'file':f'{name}.png','source':str(source.relative_to(ROOT)),
                'kind':'v323 LIVE capture or replay of same persisted LIVE run',
                'privacyReview':'No seller contacts, person names or credentials visible'})
        for name, original in [('assistant-client','01-client-demo.png'),('assistant-task','03-task-demo.png')]:
            source=legacy/'v323-assistant'/original
            annotate(source,images/f'{name}.png',crop=(790,0,1366,768))
            evidence.append({'file':f'{name}.png','source':str(source.relative_to(ROOT)),
                'kind':'archived synthetic DEMO; no new provider call','crop':[790,0,1366,768],
                'privacyReview':'Assistant panel only; customer contact fields excluded'})
    (images/'figure-sources.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n',encoding='utf8')


def para(c, text, y, size=10.8, leading=15.2, color='#25364B', width=495, bold=False):
    st=ParagraphStyle('guide',fontName='Arial-Bold' if bold else 'Arial',fontSize=size,
                      leading=leading,textColor=HexColor(color),spaceAfter=0)
    p=Paragraph(markup(text),st)
    _, h=p.wrap(width,1000)
    p.drawOn(c,50,y-h)
    return y-h


def footer(c, page, chapter=''):
    c.setStrokeColor(HexColor('#D6E2EF')); c.line(50,47,545,47)
    c.setFont('Arial',8); c.setFillColor(HexColor('#62758B'))
    c.drawString(50,32,f'CRM {VERSION} · Руководство пользователя')
    c.drawRightString(545,32,str(page))
    if chapter:
        c.setFont('Arial',8); c.drawString(50,809,chapter)


def build():
    prepare_images()
    source=(DEST/'guide.md').read_text(encoding='utf-8-sig')
    chunks=re.split(r'^## (.+)$',source,flags=re.M)
    chapters=list(zip(chunks[1::2],chunks[2::2]))
    
    
    output=DEST/f'CRM-руководство-пользователя-{VERSION}.pdf'
    c=canvas.Canvas(str(output),pagesize=(595.276,841.89),pageCompression=1)
    c.setTitle(f'CRM {VERSION} — Руководство пользователя')
    c.setAuthor('CRM · Документация для сотрудников агентства')
    c.setSubject('Работа с клиентами, недвижимостью, договорами и резервными копиями')
    c.setFillColor(HexColor('#102D4F')); c.rect(0,0,596,842,fill=1,stroke=0)
    c.setFillColor(HexColor('#57C9D4')); c.rect(50,690,68,6,fill=1,stroke=0)
    para(c,f'CRM {VERSION}',658,36,43,'#FFFFFF',bold=True)
    para(c,'Руководство\nпользователя'.replace('\n',' '),592,29,36,'#FFFFFF',bold=True)
    para(c,'Для сотрудников агентства недвижимости',489,16,23,'#B9D8F0')
    para(c,'Клиенты · Обращения · Поиск объектов',429,12,20,'#FFFFFF')
    para(c,'Предложения · Задачи · Договоры',405,12,20,'#FFFFFF')
    para(c,'От первого звонка до результата — с проверкой следующего действия и сохранности данных.',321,15,23,'#FFFFFF',width=430)
    para(c,'Windows / серверный режим\nРедакция 08.11.2026 · Демонстрационные и LIVE-иллюстрации'.replace('\n',' · '),122,10,16,'#B9D8F0')
    c.showPage()
    
    para(c,'Оглавление',781,26,31,BLUE,bold=True)
    y=723
    for i,(title,_) in enumerate(chapters):
        page=i+3
        c.setFont('Arial',10); c.setFillColor(HexColor('#25364B'))
        c.drawString(50,y,title); c.drawRightString(545,y,str(page))
        c.linkAbsolute(title,f'chapter-{i}',Rect=(48,y-5,548,y+13),thickness=0)
        y-=20
    footer(c,2);c.showPage()
    qa=[]
    for i,(title,body) in enumerate(chapters):
        page=i+3
        c.bookmarkPage(f'chapter-{i}');c.addOutlineEntry(title,f'chapter-{i}',level=0)
        footer(c,page,'ПРАКТИЧЕСКОЕ РУКОВОДСТВО / '+title.split('. ',1)[0])
        y=para(c,title,780,21,26,BLUE,bold=True)-19
        blocks=re.split(r'\n\s*\n',body.strip())
        figure_count=sum(1 for b in blocks if b.strip().startswith('!['))
        figure_max=320 if figure_count<2 else (215 if i>=28 else 175)
        for block in blocks:
            figure=re.fullmatch(r'!\[(.*?)\]\((.*?)\)',block.strip(),flags=re.S)
            if figure:
                caption,file=figure.groups()
                image=Image(str(DEST/file))
                scale=min(495/image.imageWidth,min(figure_max,y-130)/image.imageHeight)
                w,h=image.imageWidth*scale,image.imageHeight*scale
                image.drawWidth=w; image.drawHeight=h
                y-=8
                if y-h<90: raise RuntimeError(f'Image overflow chapter {title}: {y-h}')
                image.drawOn(c,50,y-h);y-=h+8
                y=para(c,caption,y,8.5,11.5,'#62758B')-8
            elif re.match(r'^\d+\. ',block):
                for step in block.splitlines():
                    y=para(c,step,y)-6
                y-=4
            else:
                y=para(c,block.replace('\n',' '),y)-10
        if y<62: raise RuntimeError(f'Text overflow chapter {title}: {y}')
        qa.append({'page':page,'chapter':title,'bottom':round(y,1)})
        c.showPage()
    c.save()
    TMP.mkdir(parents=True,exist_ok=True)
    (TMP/'layout.json').write_text(json.dumps(qa,ensure_ascii=False,indent=2),encoding='utf8')
    print(f'{output.relative_to(ROOT)}: {len(chapters)+2} pages')
    if ARGS.render:
        subprocess.run(['pdftoppm','-r','110','-png',str(output),str(TMP/'page')],check=True)
        pages=sorted(TMP.glob('page-*.png'))
        
        for start in range(0,len(pages),6):
            sheet=PILImage.new('RGB',(1120,1224),'#DDE4EC')
            d=ImageDraw.Draw(sheet)
            for j,path in enumerate(pages[start:start+6]):
                im=PILImage.open(path);im.thumbnail((350,560))
                x=(j%3)*373+12;y=(j//3)*612+24
                sheet.paste(im,(x,y));d.text((x,y-16),path.stem,fill='black')
            sheet.save(TMP/f'sheet-{start//6+1}.png')


if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--render',action='store_true')
    parser.add_argument('--font-dir',type=Path,default=Path(os.environ.get('WINDIR','C:/Windows'))/'Fonts')
    parser.add_argument('--version',default='v3.2.2',choices=['v3.2.2','v3.2.3'])
    ARGS=parser.parse_args();FONTS=ARGS.font_dir
    VERSION=ARGS.version; DEST=ROOT/'docs/user-guide'/VERSION
    TMP=ROOT/'tmp/pdfs/guide'/VERSION
    for name,file in [('Arial','arial.ttf'),('Arial-Bold','arialbd.ttf'),('Arial-Italic','ariali.ttf')]:
        pdfmetrics.registerFont(TTFont(name,str(FONTS/file)))
    pdfmetrics.registerFontFamily('Arial',normal='Arial',bold='Arial-Bold',italic='Arial-Italic',boldItalic='Arial-Bold')
    build()
