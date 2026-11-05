import {describe,it,expect,vi} from 'vitest';import RealEstateScraper from 'real-estate-scrapper';import {readFileSync} from 'node:fs';import {extendSourceParsers} from '@/modules/property-search/infrastructure/parser-extension';
describe('OnRealt date-detail load is bounded',()=>{
 it('reads only three details across pages and preserves SERP on failure',async()=>{
  const client=new RealEstateScraper();const parser=client.parsers.onrealt;const fixture=JSON.parse(readFileSync('tests/fixtures/scraper/onrealt.json','utf8'));
  parser.searchPage=vi.fn(async()=>({...fixture.pages[0],results:Array.from({length:5},(_,n)=>({...fixture.results[0],id:String(n),url:`https://onrealt.ru/novosibirsk/kypit-ofis/${n}`}))}));
  const fetch=vi.fn(async(url:string)=>`<div role-element="ad" id-element="${url.split('/').at(-1)}"></div><div class="add-time">добавлено 5 ноября в 12:00</div>`);parser.fetch=fetch;
  extendSourceParsers(client);const page=await parser.searchPage({});expect(page.results).toHaveLength(5);expect(fetch).toHaveBeenCalledTimes(3);expect(page.results[0]).toHaveProperty('publishedAt');await parser.searchPage({});expect(fetch).toHaveBeenCalledTimes(3);await client.close();
 });
 it('stops extra reads after one failed detail without losing results',async()=>{
  const client=new RealEstateScraper(),parser=client.parsers.onrealt,fixture=JSON.parse(readFileSync('tests/fixtures/scraper/onrealt.json','utf8'));
  parser.searchPage=vi.fn(async()=>({...fixture.pages[0],results:[fixture.results[0],{...fixture.results[0],id:'second'}]}));const fetch=vi.fn(async()=>{throw Error('FETCH_FAILED')});parser.fetch=fetch;extendSourceParsers(client);
  expect((await parser.searchPage({})).results).toHaveLength(2);expect(fetch).toHaveBeenCalledOnce();await client.close();
 });
});
