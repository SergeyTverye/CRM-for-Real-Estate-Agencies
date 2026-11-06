import {test,expect} from '@playwright/test';
test('synthetic enterprise wizard: dry-run, resolve columns, commit, export and reopen',async({page,baseURL})=>{
 const isolated=process.env.ENTERPRISE_UI_SYNTHETIC==='true';
 const login=await page.request.post('/api/v1/auth/login',{headers:{origin:baseURL!},data:{login:isolated?'t_manager':'manager',password:isolated?'TestPassw0rd!':'E2eRukovod2026'}});expect(login.status()).toBe(200);
 await page.goto('/import');await expect(page.getByRole('heading',{name:'Рабочая книга объектов и обращений'})).toBeVisible();
 await page.getByLabel('Синтетическая или разрешённая локальная книга .xlsx').setInputFiles('tests/fixtures/synthetic/enterprise-workbook.xlsx');
 await page.getByRole('button',{name:'Проверить без загрузки в CRM'}).click();await expect(page.getByText('Требуют решения:')).toBeVisible();
 await page.getByText('Настройка сопоставления колонок и скрытых строк',{exact:true}).click();const textarea=page.getByRole('textbox',{name:'Профиль v2'});const profile=JSON.parse(await textarea.inputValue());for(const sheet of profile.sheets){sheet.defaults.priceUnit='rub_month';for(const key of Object.keys(sheet.columns))if(sheet.columns[key]===null)sheet.columns[key]='ignore';}
 await textarea.fill(JSON.stringify(profile,null,2));await page.getByRole('button',{name:'Применить профиль и повторить dry-run'}).click();await expect(page.getByText('Требуют решения:')).toHaveCount(0);
 await page.getByText('Предпросмотр по листам и разделам (координаты и коды)',{exact:true}).click();await expect(page.getByRole('cell',{name:'sheet:1',exact:true}).first()).toBeVisible();expect(await page.locator('body').innerText()).not.toContain('POLICY_SECRET');
 await page.getByLabel('Предупреждения проверены; неоднозначные сведения потребуют ручного уточнения').check();await page.getByLabel('Подтверждаю загрузку допустимых строк, пропуск ошибок и дублей').check();
 const committed=page.waitForResponse(r=>r.url().includes('/api/v1/import/enterprise/')&&r.request().method()==='POST');await page.getByRole('button',{name:'Загрузить в CRM',exact:true}).click();const response=await committed;expect(response.status()).toBe(200);const result=await response.json();await expect(page.getByText('Импорт завершён.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Отчёт совместимости'}).click();await expect(page.getByText('IMAGE_PRESERVED',{exact:false})).toBeVisible();const download=page.waitForEvent('download');await page.getByRole('link',{name:'В формат рабочего Excel',exact:true}).click();expect((await download).suggestedFilename()).toBe('enterprise-export.xlsx');
 await page.goto(`/import/${result.id}`);await expect(page.getByText('Импорт завершён.',{exact:true})).toBeVisible();await page.screenshot({path:'test-results/enterprise-workbook-synthetic.png',fullPage:true});
});
