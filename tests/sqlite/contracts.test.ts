import { beforeEach, afterAll, expect, it } from "vitest";
import { db, resetDatabase, seedBase, makeClient, makeNeed, makeProperty, type TestUsers } from "../helpers/fixtures";
import { createSqliteClient } from "@/shared/db/sqlite-client";
import { disconnectDb } from "@/shared/db/client";
let users:TestUsers;
beforeEach(async()=>{await resetDatabase();users=await seedBase();});
afterAll(disconnectDb);
it("JSON path predicates preserve relation scopes, scalar lists support exact membership, order and atomic push",async()=>{
  const c=await makeClient(users.realtor1), n=await makeNeed(users.realtor1,c.id);
  const task=await db.task.findFirstOrThrow({where:{needLinks:{some:{clientNeedId:n.id}}}});
  await db.task.update({where:{id:task.id},data:{reminderOffsets:{set:[5,15]}}});
  await Promise.all([30,60].map(value=>db.task.update({where:{id:task.id},data:{reminderOffsets:{push:value}}})));
  expect((await db.task.findUniqueOrThrow({where:{id:task.id}})).reminderOffsets).toEqual([5,15,30,60]);
  for(const filter of [{has:15},{hasEvery:[5,60]},{hasSome:[999,30]},{equals:[5,15,30,60]},{isEmpty:false}]) expect(await db.task.count({where:{reminderOffsets:filter}})).toBe(1);
  expect(await db.task.count({where:{reminderOffsets:{hasSome:[]}}})).toBe(0);
  expect(await db.task.count({where:{reminderOffsets:{equals:[60,30,15,5]}}})).toBe(0);
  const doc=await db.document.create({data:{originalName:"synthetic.txt",documentTypeCode:"other",mimeType:"text/plain",fileSize:1,storageKey:"synthetic/document-00001",uploadedBy:users.realtor1.userId,valuesSnapshot:{mode:"synthetic_payload",path:["not_a_filter"],equals:"payload",accessRoles:["realtor"],source:{kind:"client",ids:[c.id]}}}});
  expect(doc.valuesSnapshot).toMatchObject({mode:"synthetic_payload",path:["not_a_filter"],equals:"payload"});
  const where={valuesSnapshot:{path:["source","kind"],equals:"client"}};
  expect(await db.document.count({where})).toBe(1);
  expect(await db.document.count({where:{AND:[where,{uploadedBy:users.realtor2.userId}]}})).toBe(0);
  expect(await db.document.count({where:{id:doc.id,valuesSnapshot:{path:["source","ids"],array_contains:[c.id]}}})).toBe(1);
});
it("Decimal aggregates and multiply/divide retain exact scale, range and SQL rounding",async()=>{
  const a=await makeProperty(users.realtor1,{price:"0.10"}), b=await makeProperty(users.realtor1,{price:"0.20"});
  const stats=await db.property.aggregate({_avg:{price:true},_sum:{price:true}});
  expect(stats._avg.price?.toFixed(2)).toBe("0.15");expect(stats._sum.price?.toFixed(2)).toBe("0.30");
  await db.property.update({where:{id:a.id},data:{price:{multiply:"1.5"}}});
  expect((await db.property.findUniqueOrThrow({where:{id:a.id}})).price?.toString()).toBe("0.15");
  await db.property.updateMany({where:{id:{in:[a.id,b.id]}},data:{price:{divide:"2"}}});
  expect((await db.property.findUniqueOrThrow({where:{id:a.id}})).price?.toString()).toBe("0.08");
  await expect(db.property.updateMany({data:{price:{divide:"0"}}})).rejects.toThrow();
  expect((await db.property.findUniqueOrThrow({where:{id:b.id}})).price?.toString()).toBe("0.1");
});
it("deferred batch transactions roll back the whole array on a later constraint failure",async()=>{
  const c=await makeClient(users.realtor1), before=await db.client.count();
  await expect(db.$transaction([
    db.client.create({data:{displayName:"rollback",clientKind:"person",status:"active",responsibleUserId:users.realtor1.userId,createdBy:users.realtor1.userId}}),
    db.client.create({data:{id:c.id,displayName:"duplicate",clientKind:"person",status:"active",responsibleUserId:users.realtor1.userId,createdBy:users.realtor1.userId}}),
  ])).rejects.toMatchObject({code:"P2002"});
  expect(await db.client.count()).toBe(before);
  const result=await db.$transaction([db.client.count(),db.user.count()]);
  expect(result).toEqual([before,3]);
});

it("native SQLite facade supports Prisma batch promises and skipDuplicates never hides CHECK failures",async()=>{
  const native=createSqliteClient(process.env.DATABASE_URL!);
  try {
    expect(await native.$transaction([native.user.count(),native.client.count()])).toEqual([3,0]);
    await expect(native.$transaction([
      native.user.create({data:{login:"rollback_native",displayName:"synthetic",roleCode:"manager",passwordHash:"disabled"}}),
      native.user.create({data:{login:users.manager.login,displayName:"duplicate",roleCode:"manager",passwordHash:"disabled"}}),
    ])).rejects.toMatchObject({code:"P2002"});
    expect(await native.user.count()).toBe(3);
    await expect(native.user.createMany({skipDuplicates:true,data:[
      {login:"first_valid",displayName:"synthetic",roleCode:"manager",passwordHash:"disabled"},
      {login:"check_invalid",displayName:"synthetic",roleCode:"invalid",passwordHash:"disabled"},
    ]})).rejects.toThrow();
    expect(await native.user.count()).toBe(3);
    const result=await native.user.createMany({skipDuplicates:true,data:[
      {login:users.manager.login,displayName:"duplicate",roleCode:"manager",passwordHash:"disabled"},
      {login:"second_valid",displayName:"synthetic",roleCode:"realtor",passwordHash:"disabled"},
    ]});
    expect(result.count).toBe(1);
  } finally {await native.$disconnect();}
});
