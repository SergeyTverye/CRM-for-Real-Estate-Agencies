"""Validate PDF structure, Cyrillic text, page destinations and text boundaries.
Visual review of pdftoppm page PNGs remains mandatory.
"""
from pathlib import Path
import json
import re
import sys
import pdfplumber
from pypdf import PdfReader

sys.stdout.reconfigure(encoding='utf-8')
root=Path(__file__).resolve().parents[2]
folder=root/'docs/user-guide/v3.2.2'
path=folder/'CRM-руководство-пользователя-v3.2.2.pdf'
chapters=re.findall(r'^## (.+)$',(folder/'guide.md').read_text(encoding='utf-8-sig'),re.M)
reader=PdfReader(path)
assert len(reader.pages)==len(chapters)+2
assert len(reader.outline)==len(chapters)
links=reader.pages[1].get('/Annots',[])
assert len(links)==len(chapters)
with pdfplumber.open(path) as pdf:
    pages=[]
    for n,page in enumerate(pdf.pages,1):
        text=page.extract_text() or ''
        assert len(text)>120, f'Empty page {n}'
        assert '\ufffd' not in text and '\u25a0' not in text, f'Missing glyph {n}'
        assert '<br' not in text, f'Escaped markup {n}'
        if n>1:
            assert str(n) in text.splitlines()[-1], f'Page number {n}'
        if n>2:
            expected=chapters[n-3]
            assert expected.replace(' ','') in text.replace(' ','').replace('\n',''),f'Chapter mismatch {n}'
        for char in page.chars:
            assert char['x0']>=0 and char['x1']<=page.width+1, f'Horizontal clip {n}'
            assert char['top']>=0 and char['bottom']<=page.height+1, f'Vertical clip {n}'
        pages.append({'page':n,'characters':len(text),'images':len(page.images)})
for i,annotation in enumerate(links):
    dest=annotation.get_object()['/Dest']
    assert reader.get_page_number(dest[0].get_object())==i+2,f'TOC target {i}'
for page in reader.pages:
    for font in page['/Resources'].get('/Font',{}).get_object().values():
        obj=font.get_object()
        if 'Arial' in str(obj.get('/BaseFont','')):
            assert '/FontFile2' in obj['/FontDescriptor'].get_object(), 'Font not embedded'
output=root/'tmp/pdfs/guide/structure-check.json'
output.write_text(json.dumps({'pass':True,'pages':pages,'tocLinks':len(links),'bookmarks':len(reader.outline)},ensure_ascii=False,indent=2),encoding='utf8')
print(f'PASS: {len(reader.pages)} pages; {len(links)} working TOC links; embedded Cyrillic fonts; text inside page boundaries.')
