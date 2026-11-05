import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gzipSync, brotliCompressSync, deflateSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import RealEstateScraper from 'real-estate-scrapper';
import { canonicalScraperUrl } from '@/modules/property-search/infrastructure/scraper-http';
import { decodeScraperBody } from '@/modules/property-search/infrastructure/compressed-http';
import { buildScraperQuery } from '@/modules/property-search/infrastructure/source-filters';
import { SearchFilters } from '@/modules/property-search/domain/types';
import { extractListingDates } from '@/modules/property-search/infrastructure/listing-dates';
import { tabularExport } from '@/modules/export/application/tabular-export';

describe('P0-A live defect regressions', () => {
  const routes = {office:['arenda-ofisa','kypit-ofis'],retail:['arenda-torgovyh-ploshchadej','kypit-torgovuyu-ploshchad'],psn_universal:['arenda-pomeshcheniya-svobodnogo-naznacheniya','kypit-pomeshchenie-svobodnogo-naznacheniya'],free_purpose:['arenda-pomeshcheniya-svobodnogo-naznacheniya','kypit-pomeshchenie-svobodnogo-naznacheniya'],warehouse:['arenda-sklada','kypit-sklad'],production:['arenda-proizvodstva','kypit-proizvodstvo']} as const;
  for(const [purpose, paths] of Object.entries(routes)) for(const [index, operation] of (['rent','sale'] as const).entries()) it(`${purpose} × ${operation} uses canonical OnRealt path and preserves filters`,async()=>{
    const client=await RealEstateScraper.create({maxRetries:0});
    try {
      const query=buildScraperQuery(SearchFilters.parse({city:'Новосибирск',operation,priceUnit:operation==='rent'?'rub_month':'rub_total',purposes:[purpose],areaFrom:30,areaTo:500}),'onrealt',new AbortController().signal);
      const url=new URL(canonicalScraperUrl(client.parsers.onrealt.buildSearchUrl({...query,type:query.types![0]})));
      expect(url.pathname).toBe(`/novosibirsk/${paths[index]}`); expect(url.searchParams.get('min_m')).toBe('30');expect(url.searchParams.get('max_m')).toBe('500');
    }finally{await client.close();}
  });
  it.each([['gzip',gzipSync],['deflate',deflateSync],['br',brotliCompressSync]] as const)('decodes %s without relaxing size bounds',(encoding,encode)=>{
    const input=Buffer.from('Публичная карточка');expect(decodeScraperBody(encode(input),encoding,1000).equals(input)).toBe(true);
    expect(()=>decodeScraperBody(encode(Buffer.alloc(5000)),encoding,100)).toThrow();
  });
  it('rejects unsupported encoding and oversized identity response',()=>{expect(()=>decodeScraperBody(Buffer.alloc(10),'zstd',100)).toThrow('UNSUPPORTED');expect(()=>decodeScraperBody(Buffer.alloc(101),undefined,100)).toThrow('TOO_LARGE');});
  it.each([
    ['onrealt','86529013','https://onrealt.ru/novosibirsk/kypit-ofis/86529013','2026-08-17T08:07:00.000Z',null],
    ['yandex','1520155919935630221','https://realty.yandex.ru/offer/1520155919935630221/','2026-08-04T02:47:29.000Z','2026-11-05T13:38:00.000Z'],
    ['mirkvartir','371319585','https://cre.mirkvartir.ru/371319585/',null,'2026-10-03T06:01:04.000Z'],
  ] as const)('extracts real REPLAY dates only for its own identity: %s',(source,id,url,publishedAt,sourceUpdatedAt)=>{
    const html=readFileSync(`tests/fixtures/scraper/p0a-live/${source}.html`,'utf8');
    expect(extractListingDates(source,html,{id,url},'2026-11-06T10:00:00Z')).toMatchObject({publishedAt,sourceUpdatedAt});
    expect(extractListingDates(source,html,{id:'999',url:'https://example.com/999/'},'2026-11-06T10:00:00Z')).toMatchObject({publishedAt:null,sourceUpdatedAt:null});
  });
  it('exports typed styled cells, safe hyperlinks, unknown dates and hostile text',async()=>{
    const bytes=await tabularExport('xlsx',['URL','Дата публикации','Площадь','Цена','Примечание'],[['https://onrealt.ru/a','2026-11-05T10:00:00Z','42.5','2700000','=HYPERLINK("https://bad")'],['javascript:alert(1)','Дата неизвестна',null,null,'@SUM(A1)']],'Результаты',['url','date','number','money','text']);
    const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(bytes) as never);const sheet=book.worksheets[0]!;
    expect(sheet.getCell('A2').hyperlink).toBe('https://onrealt.ru/a');expect(sheet.getCell('A3').hyperlink).toBeUndefined();expect(sheet.getCell('B2').value).toBeInstanceOf(Date);expect(sheet.getCell('B3').text).toBe('Дата неизвестна');expect(sheet.getCell('C2').value).toBe(42.5);expect(sheet.getCell('D2').numFmt).toContain('₽');expect(sheet.getCell('E2').text).toMatch(/^'=/);expect(sheet.getColumn(1).width).toBeGreaterThan(40);expect(sheet.getCell('E2').alignment.wrapText).toBe(true);expect(sheet.views[0]).toMatchObject({state:'frozen',ySplit:1});expect(sheet.autoFilter).toBeTruthy();expect(sheet.getRow(1).height).toBeGreaterThan(40);
  });
});
