import { describe, it, expect, vi } from 'vitest';
import { scraperHttpRequest } from '@/modules/property-search/infrastructure/scraper-http';
const network=vi.hoisted(()=>({safe:vi.fn(),compressed:vi.fn()}));
vi.mock('@/shared/net/ssrf',()=>({safeRequest:network.safe}));
vi.mock('@/modules/property-search/infrastructure/compressed-http',()=>({compressedScraperRequest:network.compressed}));
describe('P0-A compressed transport keeps redirect security',()=>{
 it('uses decompression only for MIR and follows its own domain',async()=>{
  network.compressed.mockReset().mockResolvedValueOnce({status:301,headers:{location:'https://arendacre.mirkvartir.ru/listing/'},data:Buffer.alloc(0),url:'https://cre.mirkvartir.ru/listing/'}).mockResolvedValueOnce({status:200,headers:{},data:Buffer.from('ok'),url:'https://arendacre.mirkvartir.ru/listing/'});
  expect((await scraperHttpRequest('https://cre.mirkvartir.ru/listing/',{headers:{cookie:'private',authorization:'private'}})).status).toBe(200);
  expect(network.compressed.mock.calls[1]![1].headers).toEqual({});expect(network.safe).not.toHaveBeenCalled();
 });
 it('rejects private and unrelated redirect targets before dispatch',async()=>{
  for(const location of ['http://cre.mirkvartir.ru/','https://127.0.0.1/','https://evil.example/']){
   network.compressed.mockReset().mockResolvedValue({status:302,headers:{location},data:Buffer.alloc(0)});
   await expect(scraperHttpRequest('https://cre.mirkvartir.ru/listing/')).rejects.toThrow('UNSAFE_SCRAPER_REDIRECT');expect(network.compressed).toHaveBeenCalledTimes(1);
  }
 });
 it('canonicalizes retail rent before the ordinary safe transport call',async()=>{
  network.safe.mockResolvedValue({status:200,headers:{},data:Buffer.from('ok')});
  await scraperHttpRequest('https://onrealt.ru/novosibirsk/arenda-torgovoj-ploshchadi?min_m=30');
  expect(network.safe.mock.calls.at(-1)![0]).toBe('https://onrealt.ru/novosibirsk/arenda-torgovyh-ploshchadej?min_m=30');
 });
});
