import { scraperHttpRequest } from '../../src/modules/property-search/infrastructure/scraper-http';
import { writeFileSync } from 'node:fs';
async function main() {
const evidence=[];
for(const url of ['https://onrealt.ru/core/api-region/?input='+encodeURIComponent('Кольцово'),'https://onrealt.ru/novosibirskaya-oblast/arenda-ofisa','https://arendacre.mirkvartir.ru/'+encodeURIComponent('Новосибирская+область')+'/']) {
 try { const r=await scraperHttpRequest(url,{timeoutMs:15000}); const html=r.data.toString('utf8'); const e={url,status:r.status,final:r.url,head:html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/iu)?.[1]?.replace(/<[^>]*>/gu,''),geoLinks:[...html.matchAll(/href="([^"]*(?:Кольцово|Краснообск|koltsovo|krasnoobsk|%D0%9A%D0%BE%D0%BB)[^"]*)"/gu)].slice(0,15).map(m=>m[1]),region: url.includes('api-region') ? JSON.parse(html) : undefined}; evidence.push(e); console.log(JSON.stringify(e)); } catch { console.log('lookup failed'); }
 await new Promise(r=>setTimeout(r,1100));
}
writeFileSync('docs/vkr/v323-geo-discovery.json',JSON.stringify(evidence,null,2)+'\n');

}
void main();
