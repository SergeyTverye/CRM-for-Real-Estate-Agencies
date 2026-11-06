import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import ExcelJS from 'exceljs';
export async function makeEnterpriseSynthetic() {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Synthetic fixture';
    wb.created = new Date('2026-01-01T00:00:00Z');
    for (let si = 1; si <= 6; si++) {
        const ws = wb.addWorksheet(`Синтетика ${si}`);
        ws.columns = Array.from({ length: si === 4 ? 20 : 9 }, (_, i) => ({ width: i === 5 ? 65 : 22 }));
        const headers = si <= 3 ? ['Метка', '№', 'Адрес', 'Площадь', 'Цена', 'Описание', 'Этаж', 'Контакт собственника', 'Неизвестная колонка'] : si === 4 ? ['', '№', 'Клиент', 'Телефон', 'Дата', 'E-mail', 'E-mail', 'Запрос', 'Источник', 'Статус', 'Комментарий', 'Ответственный', 'Паспорт', 'Кем выдан', 'Регистрация', 'Дата рождения', 'Операция', 'Район', 'Назначение', 'Неизвестная колонка'] : si === 5 ? ['Статус', '№', 'Адрес', 'Площадь', 'Цена', 'Источник', 'Договор', 'Комиссия', 'Комментарий'] : ['Класс', 'Код', 'Значение', 'Порядок', 'Включено'];
        ws.addRow(headers).font = { bold: true };
        if (si <= 3) {
            for (let n = 0; n < 50; n++) {
                if (n === 0 || n === 25) {
                    ws.addRow([n === 0 ? 'Аренда / офис / Северный' : 'Продажа / склад / Южный']).font = { bold: true };
                }
                const row = ws.addRow(['А', n + 1, `г. Вымышленный, ул. Тестовая ${si}, д. ${n + 1}`, n % 2 ? '45 м2' : 45 + n, n % 2 ? '1,5 млн' : '12 000 000 руб.', 'Синтетическое описание без коммерческих сведений. '.repeat(5 + n % 20), '1/5 эт.', '+7 (000) 000-00-01', n === 1 ? 'только синтетика' : null]);
                row.hidden = n >= 8;
                if (si === 2 && n < 31)
                    row.getCell(6).value = { text: 'Синтетическое описание. '.repeat(10), hyperlink: `https://example.invalid/synthetic/${n}` };
            }
            if (si === 2) {
                const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
                for (let i = 0; i < 15; i++) {
                    const id = wb.addImage({ buffer: png, extension: 'png' });
                    ws.addImage(id, { tl: { col: 8, row: 3 + i * 2 }, ext: { width: 10, height: 10 } });
                }
            }
        }
        if (si === 4) {
            ws.addRow(['Журнал / аренда']).font = { bold: true };
            for (let n = 0; n < 10; n++) {
                const r = ws.addRow(['', n + 1, `Вымышленный клиент ${n}`, `+7 (900) 000-${String(n).padStart(2, '0')}-01; +7 (901) 000-${String(n).padStart(2, '0')}-02`, new Date(Date.UTC(2026, 0, n + 1)), `synthetic${n}@example.invalid`, `second${n}@example.invalid`, 'Аренда офиса', 'Тестовый источник', 'новый', 'Синтетический комментарий', 'Тестовый сотрудник', 'POLICY_SECRET_PASSPORT', 'POLICY_SECRET_ISSUER', 'POLICY_SECRET_REGISTRATION', '1980-01-01', 'Аренда', 'Северный', 'офис', null]);
                r.getCell(5).numFmt = 'dd.mm.yyyy';
            }
        }
        if (si === 5) {
            for (let n = 2; n <= 30; n++) {
                if (n === 17) {
                    ws.getRow(n).values = headers;
                    ws.getRow(n).font = { bold: true };
                    continue;
                }
                ws.getRow(n).values = ['закрыто', n, `Тестовый архив ${n}`, `45 м2`, '12 000 000 руб.', 'тест', `SYN-${n}`, '100 тыс.', 'синтетика'];
            }
            ws.mergeCells('A32:B32');
            ws.getCell('A32').value = 'Служебная секция';
            ws.getCell('A32').font = { bold: true };
        }
        if (si === 6)
            for (let n = 0; n < 5; n++)
                ws.addRow(['служебная', n, 'синтетика', n, true]);
        if (si <= 4)
            ws.autoFilter = { from: 'A1', to: `${si === 4 ? 'T' : 'I'}${ws.rowCount}` };
        if (si === 2 || si === 3)
            ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];
    }
    for (let n = 1; n <= 4; n++)
        wb.definedNames.add(`'Синтетика ${n}'!$C$3:$C$7`, `SyntheticRange${n}`);
    return Buffer.from(await wb.xlsx.writeBuffer());
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const out = resolve('tests/fixtures/synthetic/enterprise-workbook.xlsx');
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, await makeEnterpriseSynthetic());
    console.log(JSON.stringify({ synthetic: true, sheets: 6 }));
}
