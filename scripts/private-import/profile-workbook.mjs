import ExcelJS from 'exceljs';
import { unzipSync } from 'fflate';
import { DOMParser } from '@xmldom/xmldom';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const hash = s => createHash('sha256').update(s).digest('hex').slice(0, 8);
const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const dictionary = [
 ['price_per_m2', /цен.*(?:м2|м²|метр)|price.?per/], ['rent_rate', /ставк|rent.?rate/],
 ['date_published', /дат.*публи|date.?published/], ['contact_person', /контактн.*лиц|contact.?person/],
 ['owner_name', /собствен|владел|owner/], ['responsible', /ответствен|риелтор|responsible/],
 ['address', /адрес|address/], ['district', /район|district/], ['area_m2', /площад|area/],
 ['price', /цен|стоим|price/], ['operation', /операц|аренда.продажа|operation/],
 ['purpose', /назнач|purpose/], ['floor', /этаж|floor/], ['phone', /телефон|phone/],
 ['email', /почт|e.?mail/], ['status', /статус|status/], ['date', /дата|date/],
 ['source', /источник|source/], ['url', /ссылк|url/], ['comment', /коммент|примеч|comment/],
 ['id/number', /^(?:id|номер|№|number)(?:\b|$)/],
];
const classify = s => dictionary.find(([, re]) => re.test(s.toLowerCase()))?.[0] ?? 'unknown';
const knownFunctions = new Set('SUM IF IFS IFERROR VLOOKUP HLOOKUP XLOOKUP INDEX MATCH COUNT COUNTA COUNTIF COUNTIFS SUMIF SUMIFS AVERAGE MIN MAX ROUND AND OR NOT TODAY NOW DATE YEAR MONTH DAY CONCAT CONCATENATE LEFT RIGHT MID LEN TRIM TEXT VALUE SUBSTITUTE INDIRECT OFFSET HYPERLINK'.split(' '));
const types = ['string','number','date','boolean','formula','error','empty','richText','hyperlink'];
const letter = n => { let s = ''; for (; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
const address = s => typeof s === 'string' && /^\$?[A-Z]{1,3}\$?\d{1,7}(?::\$?[A-Z]{1,3}\$?\d{1,7})?$/.test(s) ? s : null;
const num = s => /^\d+(?:\.\d+)?$/.test(s ?? '') ? Number(s) : null;
const nodes = (doc, name) => Array.from(doc.getElementsByTagName(name));
function xml(bytes) {
 const s = Buffer.from(bytes).toString('utf8');
 if (/<!DOCTYPE|<!ENTITY/i.test(s)) throw new Error('invalid');
 return new DOMParser({ onError: () => { throw new Error('invalid'); } }).parseFromString(s, 'application/xml');
}
function text(c) {
 const v = c.value;
 return typeof v === 'string' ? v : v?.richText ? v.richText.map(r => r.text).join('') : v?.hyperlink ? v.text ?? '' : '';
}
function kind(c) {
 const v = c.value;
 if (v == null || v === '') return 'empty';
 if (v instanceof Date) return 'date';
 if (typeof v === 'object') return v.formula || v.sharedFormula ? 'formula' : v.error ? 'error' : v.richText ? 'richText' : v.hyperlink ? 'hyperlink' : 'empty';
 return typeof v;
}
function formulaShape(c) {
 const f = (c.formula ?? '').replace(/"(?:[^"]|"")*"/g,' ').replace(/'(?:[^']|'')*'!/g,' ').replace(/\[[^\]]*\]/g,' ').replace(/[\p{L}_][\p{L}\p{N}_.]*!/gu,' ');
 const names = [...f.matchAll(/\b([A-Z][A-Z0-9_.]*)\s*\(/gi)].map(m => m[1].toUpperCase());
 const refs = [...f.matchAll(/(?<![\p{L}\p{N}_])\$?([A-Z]{1,3})\$?(\d{1,7})(?![\p{L}\p{N}_]|\s*\()/gu)].map(m => ({ rowOffset: Number(m[2])-c.row, colOffset: [...m[1]].reduce((n,s) => n*26+s.charCodeAt(0)-64,0)-c.col }));
 return {functions: [...new Set(names.filter(n => knownFunctions.has(n)))].sort(), unknownFunctionCount: names.filter(n => !knownFunctions.has(n)).length, relativeReferences: refs};
}
function column(ws, col, start, end, header, formatIds) {
 const counts = Object.fromEntries(types.map(t => [t,0])), lengths = [], unique = new Set(), formats = new Map(), shapes = new Map();
 let phone=0, email=0, date=0, monetary=0;
 for (let r=start; r<=end; r++) {
  const c=ws.getCell(r,col), t=kind(c); counts[t]++;
  if(t==='empty') continue;
  unique.add(digest(c.value));
  const s=text(c);
  if(['string','richText','hyperlink'].includes(t)) lengths.push(s.length);
  if(/^[+\d()\s.-]+$/.test(s) && s.replace(/\D/g,'').length>=10 && s.replace(/\D/g,'').length<=15) phone++;
  if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) email++;
  if(/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}(?:\s|$)/.test(s)) date++;
  const fmt=c.numFmt ?? 'General';
  if(/[$€£₽]|руб|\[\$|currency/i.test(fmt)) monetary++;
  formats.set(fmt,{id:formatIds.get(c.address)??0,hash:hash(fmt),class:/[$€£₽]|руб|\[\$/i.test(fmt)?'money':/[dy]/i.test(fmt.replace(/"[^"]*"/g,''))?'date':fmt==='General'?'general':'custom'});
  if(t==='formula') {const shape=formulaShape(c); shapes.set(JSON.stringify(shape),shape);}
 }
 const total=Math.max(0,end-start+1),filled=total-counts.empty;
 lengths.sort((a,b)=>a-b); const mid=Math.floor(lengths.length/2);
 return {index:col,letter:letter(col),header:{class:classify(header),hash:hash(header),length:header.length,unresolved:classify(header)==='unknown'},total,filled,fillRatio:total?filled/total:0,
 typeCounts:counts,typeRatios:Object.fromEntries(types.map(t=>[t,total?counts[t]/total:0])),numberFormats:[...formats.values()],hasFormulas:counts.formula>0,formulaShapes:[...shapes.values()],
 signals:{phone:filled?phone/filled:0,email:filled?email/filled:0,textDate:filled?date/filled:0,monetaryFormat:filled?monetary/filled:0},
 stringLengths:{min:lengths[0]??null,median:lengths.length?(lengths.length%2?lengths[mid]:(lengths[mid-1]+lengths[mid])/2):null,max:lengths.at(-1)??null},cardinality:unique.size,duplicateRatio:filled?(filled-unique.size)/filled:0};
}
export async function profileWorkbook(input) {
 const bytes=await readFile(input);
 if(bytes.length>64*1024*1024) throw new Error('limit');
 let expanded=0;
 const zip=unzipSync(bytes,{filter:entry=>{expanded+=entry.originalSize;if(expanded>256*1024*1024)throw new Error('limit');return /^(?:xl\/|\[Content_Types\]\.xml$)/.test(entry.name);}});
 if(Object.keys(zip).some(n=>/vbaProject\.bin$/i.test(n)))throw new Error('macros');
 const wbXml=xml(zip['xl/workbook.xml']),rels=nodes(xml(zip['xl/_rels/workbook.xml.rels']),'Relationship');
 const styles=zip['xl/styles.xml']?nodes(xml(zip['xl/styles.xml']),'cellXfs')[0]:null;
 const styleIds=styles?nodes(styles,'xf').map(n=>num(n.getAttribute('numFmtId'))??0):[0];
 if(nodes(wbXml,'sheet').some(s => s.getAttribute('name').length>31))throw new Error('invalid');
 const book=new ExcelJS.Workbook();await book.xlsx.load(bytes);
 const sheets=[];
 for(const [i,sheet] of nodes(wbXml,'sheet').entries()) {
  const ws=book.worksheets[i],target=rels.find(r=>r.getAttribute('Id')===sheet.getAttribute('r:id'))?.getAttribute('Target');
  if(!target)throw new Error('invalid');
  const sheetPath=target.startsWith('/')?target.slice(1):path.posix.normalize(`xl/${target}`),doc=xml(zip[sheetPath]);
  const formatIds=new Map(nodes(doc,'c').map(c=>[c.getAttribute('r'),styleIds[num(c.getAttribute('s'))??0]??0]));
  const rows=ws.rowCount,cols=ws.columnCount;
  if(rows*cols>2_000_000)throw new Error('limit');
  const occupied=r=>r>0&&r<=rows&&ws.getRow(r).actualCellCount>0;
  const headers=[];
  for(let r=1;r<rows;r++) {
   const cells=[];ws.getRow(r).eachCell(c=>{if(!c.isMerged||c.master.address===c.address)cells.push(c);});
   const texts=cells.filter(c=>text(c).trim());
   let previousTextCount=0;ws.getRow(r-1||1).eachCell(c=>{if(text(c).trim()&&(!c.isMerged||c.master.address===c.address))previousTextCount++;});
   if(texts.length>=3&&occupied(r+1)&&(r===1||previousTextCount<3||texts.filter(c=>classify(text(c))!=='unknown').length>=2))headers.push(r);
  }
  const allRows=new Set(),addressArea=new Set();let duplicateRows=0,duplicateAddressArea=0;
  const blocks=headers.map((r,hi)=>{
   let end=r;const limit=(headers[hi+1]??rows+1)-1;
   while(end<limit&&occupied(end+1))end++;
   const hc=[];ws.getRow(r).eachCell(c=>{if(text(c)&&(!c.isMerged||c.master.address===c.address))hc.push(c.col);});
   const startCol=Math.min(...hc),endCol=Math.max(...hc);
   const columns=Array.from({length:endCol-startCol+1},(_,ci)=>column(ws,startCol+ci,r+1,end,text(ws.getCell(r,startCol+ci)),formatIds));
   const ac=columns.find(c=>c.header.class==='address'),ar=columns.find(c=>c.header.class==='area_m2');
   for(let dr=r+1;dr<=end;dr++) {
    const key=digest(columns.map(c=>ws.getCell(dr,c.index).value));
    if(allRows.has(key))duplicateRows++;allRows.add(key);
    if(ac&&ar&&ws.getCell(dr,ac.index).value!=null&&ws.getCell(dr,ar.index).value!=null){const pair=digest([ws.getCell(dr,ac.index).value,ws.getCell(dr,ar.index).value]);if(addressArea.has(pair))duplicateAddressArea++;addressArea.add(pair);}
   }
   return {headerRow:r,dataStartRow:r+1,endRow:end,startCol,endCol,columns};
  });
  const hiddenIndices=nodes(doc,'col').filter(c=>c.getAttribute('hidden')==='1').flatMap(c=>{const min=num(c.getAttribute('min')),max=num(c.getAttribute('max'));return min&&max&&max>=min&&max<=16384?Array.from({length:max-min+1},(_,j)=>min+j):[];});
  const merges=nodes(doc,'mergeCell').map(c=>address(c.getAttribute('ref'))).filter(Boolean);
  let comments=0;ws.eachRow(row=>row.eachCell(c=>{if(c.note)comments++;}));
  sheets.push({ordinal:i+1,nameHash:hash(ws.name),nameLength:ws.name.length,visibility:['visible','hidden','veryHidden'].includes(ws.state)?ws.state:'visible',rows,cols,
   mergedRangeCount:merges.length,mergedRanges:merges,hiddenRowCount:nodes(doc,'row').filter(r=>r.getAttribute('hidden')==='1').length,hiddenColumnCount:hiddenIndices.length,hiddenColumnIndices:hiddenIndices,
   autoFilter:address(nodes(doc,'autoFilter')[0]?.getAttribute('ref')),
   panes:nodes(doc,'pane').map(p=>({state:['frozen','frozenSplit','split'].includes(p.getAttribute('state'))?p.getAttribute('state'):null,xSplit:num(p.getAttribute('xSplit')),ySplit:num(p.getAttribute('ySplit')),topLeftCell:address(p.getAttribute('topLeftCell'))})),
   columnWidths:nodes(doc,'col').map(c=>({min:num(c.getAttribute('min')),max:num(c.getAttribute('max')),width:num(c.getAttribute('width'))})),
   conditionalFormattingCount:nodes(doc,'cfRule').length,dataValidationCount:nodes(doc,'dataValidation').length,imageCount:ws.getImages().length,commentCount:comments,hyperlinkCount:nodes(doc,'hyperlink').length,
   blocks,duplicateRows,duplicateAddressArea});
 }
 return {schemaVersion:1,sheetCount:sheets.length,definedNameCount:nodes(wbXml,'definedName').length,externalLinks:Object.keys(zip).some(n=>n.startsWith('xl/externalLinks/'))||rels.some(r=>/externalLink$/.test(r.getAttribute('Type'))),macros:false,sheets};
}
export async function main(args=process.argv.slice(2)) {
 try {
  if(args.length!==3||args[1]!=='--out'||path.resolve(args[0])===path.resolve(args[2])||path.extname(args[0]).toLowerCase()!=='.xlsx')throw new Error('usage');
  const result=`${JSON.stringify(await profileWorkbook(args[0]),null,2)}\n`;
  await mkdir(path.dirname(path.resolve(args[2])),{recursive:true});
  await writeFile(args[2],result,{flag:'wx',mode:0o600});process.stdout.write(result);return 0;
 }catch{process.stderr.write('PROFILE_FAILED: check arguments, output existence, XLSX validity and resource limits locally.\n');return 1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)process.exitCode=await main();

