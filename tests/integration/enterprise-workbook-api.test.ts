import { readFile } from 'node:fs/promises';
import { beforeEach,expect,it } from 'vitest';
import { db,resetDatabase,seedBase,sessionCookieFor,apiRequest,routeParams,type TestUsers } from '../helpers/fixtures';
import { uploadEnterprise } from '@/modules/import/application/enterprise-service';
import { buildProfile,loadEnterprise } from '@/modules/import/domain/enterprise-workbook';
import { GET,POST,PATCH } from '@/app/api/v1/import/enterprise/[id]/route';
import { GET as EXPORT } from '@/app/api/v1/import/enterprise/[id]/export/route';
let u:TestUsers;
beforeEach(async()=>{await resetDatabase();u=await seedBase();});
it('v2 API session, role, Origin and mapping version gate',async()=>{
 const data=await readFile('tests/fixtures/synthetic/enterprise-workbook.xlsx');const p=buildProfile(await loadEnterprise(data));for(const s of p.sheets){s.defaults.priceUnit='rub_month';for(const k of Object.keys(s.columns))if(s.columns[k]===null)s.columns[k]='ignore';}
 const job=await uploadEnterprise(u.manager,new File([new Uint8Array(data)],'synthetic.xlsx'),p);const params=routeParams({id:job.id});
 expect((await GET(apiRequest('GET',`/api/v1/import/enterprise/${job.id}`),params)).status).toBe(401);
 const realtorCookie=await sessionCookieFor(u.realtor1);for(const handler of [GET,POST,PATCH,EXPORT]){const r=await handler(apiRequest(handler===GET||handler===EXPORT?'GET':'POST',`/api/v1/import/enterprise/${job.id}`,{cookie:realtorCookie,body:handler===GET||handler===EXPORT?undefined:{}}),params);expect(r.status).toBe(403);expect(await r.text()).not.toContain('POLICY_SECRET');}
 const cookie=await sessionCookieFor(u.manager);const report=await GET(apiRequest('GET',`/api/v1/import/enterprise/${job.id}`,{cookie}),params);expect(report.status).toBe(200);const body=await report.json();expect(body.mappingVersion).toBeTruthy();expect(JSON.stringify(body)).not.toContain('POLICY_SECRET');
 expect((await POST(apiRequest('POST',`/api/v1/import/enterprise/${job.id}`,{cookie,origin:'https://example.invalid',body:{}}),params)).status).toBe(403);
 expect((await POST(apiRequest('POST',`/api/v1/import/enterprise/${job.id}`,{cookie,body:{confirmed:true,acceptWarnings:true,expectedMappingVersion:'stale'}}),params)).status).toBe(409);expect(await db.property.count()).toBe(0);
});
