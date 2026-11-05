import type { OfferPrintData } from "@/modules/commercial-offers/application/offer-print-data";

const esc = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const text = (value: string) => esc(value).replace(/\n/g, "<br>");

export const OFFER_PRINT_CSS = `
@page { size: A4 portrait; margin: 15mm 16mm 16mm; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #fff; color: #172b3e; font-family: Arial, sans-serif; font-size: 10pt; line-height: 1.45; }
.offer-print { max-width: 178mm; margin: 0 auto; }
.offer-print h1 { font-size: 25pt; line-height: 1.15; margin: 9mm 0 4mm; font-weight: 700; }
.offer-print h2 { font-size: 16pt; line-height: 1.25; margin: 0 0 4mm; }
.offer-print h3 { font-size: 11pt; margin: 5mm 0 2mm; }
.offer-print p { margin: 2mm 0 4mm; orphans: 3; widows: 3; }
.offer-print .issuer { display: flex; align-items: center; gap: 6mm; margin-bottom: 6mm; }
.offer-print .logo { width: 30mm; height: 20mm; object-fit: contain; }
.offer-print .issuer-name { font-size: 13pt; font-weight: 700; }
.offer-print .requisites { font-size: 9pt; color: #465668; white-space: pre-wrap; overflow-wrap: anywhere; }
.offer-print .eyebrow { color: #536a80; font-size: 9pt; letter-spacing: .06em; text-transform: uppercase; }
.offer-print .cover { margin-bottom: 7mm; }
.offer-print .object { break-before: page; padding-top: 1mm; }
.offer-print .hero { display: block; width: 100%; height: 64mm; object-fit: contain; background: #f4f6f8; }
.offer-print .gallery { display: flex; gap: 3mm; margin-top: 3mm; }
.offer-print .gallery figure { flex: 1; min-width: 0; margin: 0; }
.offer-print .gallery img { width: 100%; height: 27mm; object-fit: contain; background: #f4f6f8; }
.offer-print figcaption { font-size: 8pt; color: #536a80; overflow-wrap: anywhere; }
.offer-print figure { margin: 0 0 3mm; break-inside: avoid; }
.offer-print table { border-collapse: collapse; width: 100%; table-layout: fixed; margin: 4mm 0; }
.offer-print th, .offer-print td { border-bottom: 1px solid #d9e1e8; padding: 1.5mm 2.5mm; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.offer-print th { background: #eef2f6; color: #233e55; font-weight: 700; }
.offer-print .facts th { width: 33%; }
.offer-print .comparison { font-size: 8.5pt; }
.offer-print .comparison th:first-child { width: 7%; }
.offer-print .comparison th:nth-child(2) { width: 29%; }
.offer-print .comparison th:nth-child(3) { width: 15%; }
.offer-print .comparison th:nth-child(4) { width: 25%; }
.offer-print tr { break-inside: avoid; }
.offer-print thead { display: table-header-group; }
.offer-print h2, .offer-print h3 { break-after: avoid; }
.offer-print a { color: #225d88; text-decoration: underline; overflow-wrap: anywhere; }
.offer-print .links { font-size: 8.5pt; }
.offer-print .summary { break-before: page; }
.offer-print .contact { margin-top: 8mm; padding: 4mm; background: #eef2f6; break-inside: avoid; }
.offer-print .muted { color: #536a80; font-size: 9pt; }
@media screen { body { background: #e8edf2; padding: 10mm; } .offer-print { padding: 12mm; max-width: 210mm; background: #fff; box-shadow: 0 2px 20px #172b3e14; } .object, .summary { margin-top: 14mm; border-top: 1px solid #d9e1e8; padding-top: 10mm; } }
@media print { .offer-print { max-width: none; } a { text-decoration: none; } }
`;

export function offerHtml(data: OfferPrintData): string {
  const issuer = `<header class="issuer">${data.logo ? `<img class="logo" src="${data.logo.dataUrl}" alt="Логотип">` : ""}<div><div class="issuer-name">${esc(data.issuer?.displayName ?? "Агентство недвижимости")}</div>${data.issuer?.requisites ? `<div class="requisites">${text(data.issuer.requisites)}</div>` : ""}</div></header>`;
  const objects = data.items.map(i => {
    const [hero, ...extra] = i.images;
    const facts = [["Адрес", i.address], ["Район", i.district], ["Назначение", i.purpose], ["Площадь", i.area], ["Этаж", i.floor], ["Цена / ставка", i.price], ["Цена за м²", i.perM2]];
    return `<section class="object"><p class="eyebrow">Объект ${i.position} / ${data.items.length}</p><h2>${esc(i.address)}</h2>
      ${hero ? `<figure><img class="hero" src="${hero.dataUrl}" alt="${esc(hero.caption)}"><figcaption>${esc(hero.caption)}</figcaption></figure>` : `<p class="muted">Фотографии в каталоге не добавлены.</p>`}
      ${extra.length ? `<div class="gallery">${extra.map(p => `<figure><img src="${p.dataUrl}" alt="${esc(p.caption)}"><figcaption>${esc(p.caption)}</figcaption></figure>`).join("")}</div>` : ""}
      <table class="facts"><tbody>${facts.map(([label, value]) => `<tr><th scope="row">${label}</th><td>${esc(value!)}</td></tr>`).join("")}</tbody></table>
      ${i.terms ? `<h3>Условия</h3><p>${text(i.terms)}</p>` : ""}${i.comment ? `<h3>Примечания</h3><p>${text(i.comment)}</p>` : ""}
      <div class="links"><p>Карточка CRM: <a href="${esc(i.propertyUrl)}">${esc(i.propertyUrl)}</a></p>${i.sourceUrl ? `<p>Первоисточник: <a href="${esc(i.sourceUrl)}">${esc(i.sourceUrl)}</a></p>` : ""}</div></section>`;
  }).join("");
  const summary = `<section class="summary"><h2>Сравнение объектов</h2><table class="comparison"><thead><tr><th>№</th><th>Объект</th><th>Площадь</th><th>Цена / ставка</th><th>Цена за м²</th></tr></thead><tbody>${data.items.map(i => `<tr><td>${i.position}</td><td>${esc(i.address)}<br>${esc(i.district)}<br>${esc(i.purpose)}</td><td>${esc(i.area)}</td><td>${esc(i.price)}</td><td>${esc(i.perM2)}</td></tr>`).join("")}</tbody></table>
    ${data.expires ? `<p>Предложение действительно до ${esc(data.expires)}.</p>` : ""}
    <div class="contact"><h3>Ваш ответственный специалист</h3><p><strong>${esc(data.responsible)}</strong></p>${data.issuer?.requisites ? `<div class="requisites">${text(data.issuer.requisites)}</div>` : ""}</div>
    <p class="muted">Цена, адрес, площадь и условия зафиксированы в предложении. Фотографии взяты из доступного каталога CRM; материалы внешних площадок доступны по ссылке на первоисточник.</p></section>`;
  const contents = `<h3>В предложении</h3>${data.items.map(i => `<p><strong>${i.position}. ${esc(i.address)}</strong><br><span class="muted">${esc(i.area)} · ${esc(i.price)}</span></p>`).join("")}`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(data.title)}</title><style>${OFFER_PRINT_CSS}</style></head><body><article class="offer-print"><div class="cover">${issuer}<p class="eyebrow">Подборка недвижимости · ${esc(data.date)}</p><h1>${esc(data.title)}</h1><p>${text(data.intro)}</p><p class="muted">Объектов в предложении: ${data.items.length} · Ответственный: ${esc(data.responsible)}</p>${contents}</div>${objects}${summary}</article></body></html>`;
}
