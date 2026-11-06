import ExcelJS from 'exceljs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function makeSyntheticWorkbook(out = 'tests/fixtures/synthetic/workbook-like.xlsx') {
 const wb = new ExcelJS.Workbook();
 const ws = wb.addWorksheet('СИНТЕТИКА_основной_лист');
 const headers = ['Адрес синтетический','Площадь синтетическая','Цена синтетическая','Телефон синтетический','Почта синтетическая','Дата синтетическая','Комментарий синтетический','Ссылка синтетическая','Расчёт синтетический','Флаг синтетический','Неизвестное поле синтетики'];
 ws.mergeCells('A1:K1'); ws.getCell('A1').value = 'СЕКРЕТ_СИНТЕТИКИ_заголовок_секции';
 ws.getRow(2).values = headers; ws.getRow(2).font = {bold:true};
 const values = ['СИНТ_улица_невозможная_700',87.25,1234567,'+7 (999) 000-12-34','synthetic-only@example.invalid',new Date('2026-01-02T00:00:00Z'),{richText:[{text:'СИНТ_богатый_текст_уникальный'}]},{text:'СИНТ_текст_гиперссылки',hyperlink:'https://synthetic.invalid/private-link'},{formula:'IF(B3>0,SUM(B3,C3),"СИНТ_секрет_формулы")',result:1234654.25},true,{error:'#DIV/0!'}];
 ws.getRow(3).values=values; ws.getRow(4).values=structuredClone(values);
 ws.getRow(5).values=['СИНТ_другой_адрес',101,5432100,'+7 (999) 000-56-78','synthetic-two@example.invalid','03.04.2026','СИНТ_обычный_комментарий'];
 for(const r of [3,4,5])ws.getCell(r,3).numFmt='"СИНТ_секрет_формата" #,##0.00 "₽"';
 for(const r of [3,4])ws.getCell(r,6).numFmt='dd.mm.yyyy';
 ws.getCell('A3').note='СИНТ_секрет_комментария';
 ws.getCell('B3').dataValidation={type:'decimal',operator:'greaterThan',formulae:[0]};
 ws.addConditionalFormatting({ref:'C3:C5',rules:[{type:'cellIs',operator:'greaterThan',formulae:[1000],style:{font:{bold:true}}}]});
 ws.getRow(4).hidden=true; ws.getColumn(7).hidden=true;ws.getColumn(1).width=32;
 ws.autoFilter='A2:K5';ws.views=[{state:'frozen',xSplit:1,ySplit:2}];
 ws.getRow(8).values=headers;ws.getRow(8).font={bold:true};
 ws.getRow(9).values=['СИНТ_второй_блок',62,99000,'+7 (999) 000-90-12','synthetic-three@example.invalid'];
 wb.definedNames.add("'СИНТЕТИКА_основной_лист'!$A$3",'СИНТ_закрытое_имя');
 const image=wb.addImage({base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',extension:'png'});
 ws.addImage(image,'M2:N3');
 for(const [name,state] of [['СИНТЕТИКА_скрытый_лист','hidden'],['СИНТЕТИКА_очень_скрытый','veryHidden']]) {
  const s=wb.addWorksheet(name,{state});s.addRow(headers.slice(0,3));s.addRow(['СИНТ_строка_скрытого_листа',44,990]);
 }
 await mkdir(path.dirname(path.resolve(out)),{recursive:true});await wb.xlsx.writeFile(out);
 return wb;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await makeSyntheticWorkbook(process.argv[2]);
