import { describe, expect, it, vi } from 'vitest';
import { defaultScraperFactory, isCianAccessChallenge } from '@/modules/property-search/infrastructure/scraper-adapter';
import { verifyListingPage } from '@/modules/ai/infrastructure/verify-listing-page';
import { safeRequest } from '@/shared/net/ssrf';
vi.mock('@/shared/net/ssrf', async original => ({ ...await original<typeof import('@/shared/net/ssrf')>(), safeRequest: vi.fn() }));
describe('live findings regressions', () => {
 it('classifies a 200 challenge without fabricating HTTP 403', async () => {
  const client = await defaultScraperFactory({ maxRetries: 0, transport: async () => ({ status: 200, data: '<script src="/captcha.js"></script>' }) });
  try {
   const result = await client.searchSite('cian', {city:'Novosibirsk',category:'commercial',types:['office'],deal:'sale',sources:['cian'],maxPages:1,sourceOptions:{cian:{regionId:4897}}});
   expect(result.errors[0]).toMatchObject({code:'NEEDS_USER_ACTION',error:'NEEDS_USER_ACTION'});
   expect(result.errors[0]?.status).toBeUndefined();
   expect(result.results).toHaveLength(0);
  } finally { await client.close(); }
 });
 it('distinguishes Cian HTTP 200 CAPTCHA from a real empty page', () => {
  expect(isCianAccessChallenge('https://novosibirsk.cian.ru/cat.php', '<script src="/captcha.js"></script>')).toBe(true);
  expect(isCianAccessChallenge('https://cian.ru/cat.php', 'legacy-commercial-serp-frontend captcha')).toBe(false);
  expect(isCianAccessChallenge('https://cian.ru/cat.php', 'Nothing found')).toBe(false);
  expect(isCianAccessChallenge('https://evil.test/', 'captcha')).toBe(false);
 });
 it('does not fetch catalogue/private URLs', async () => {
  vi.mocked(safeRequest).mockClear();
  expect(await verifyListingPage('http://127.0.0.1/')).toBe('UNSAFE_OR_NON_CARD_URL');
  expect(await verifyListingPage('https://cian.ru/kupit-ofis/')).toBe('UNSAFE_OR_NON_CARD_URL');
  expect(safeRequest).not.toHaveBeenCalled();
 });
 it.each([401,403,429,439])('leaves blocked card %i for review without retries', async status => {
  vi.mocked(safeRequest).mockReset().mockResolvedValue({status,url:'https://cian.ru/sale/commercial/123/',data:Buffer.from(''),headers:{}});
  expect(await verifyListingPage('https://cian.ru/sale/commercial/123/')).toBe(`BLOCKED_HTTP_${status}`);
  expect(safeRequest).toHaveBeenCalledTimes(1);
  expect(safeRequest).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({followRedirects:false,timeoutMs:4000}));
 });
 it('keeps a reachable page unconfirmed', async () => {
  vi.mocked(safeRequest).mockResolvedValue({status:200,url:'https://cian.ru/sale/commercial/123/',data:Buffer.from('<html>Offer</html>'),headers:{'content-type':'text/html'}});
  expect(await verifyListingPage('https://cian.ru/sale/commercial/123/')).toBe('HTML_REACHABLE_NEEDS_REVIEW');
 });
 it('bounds network failure without failing the web result', async () => {
  vi.mocked(safeRequest).mockRejectedValue(new Error('timeout'));
  expect(await verifyListingPage('https://cian.ru/sale/commercial/123/')).toBe('UNAVAILABLE_NEEDS_REVIEW');
 });
});
