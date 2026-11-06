import type { PrismaClient } from "../../src/generated/prisma/client";
/** Synthetic demo subset, all records owned by the explicitly created manager. */
export async function seedDesktopDemo(db: PrismaClient, managerId: string) {
  for(let i=1;i<=5;i++) {
    await db.$transaction(async tx=>{
      const client=await tx.client.create({data:{displayName:`ДЕМО: клиент ${i}`,clientKind:"person",status:"active",responsibleUserId:managerId,createdBy:managerId,notes:"Синтетические демонстрационные данные"}});
      const need=await tx.clientNeed.create({data:{clientId:client.id,responsibleUserId:managerId,createdBy:managerId,operationType:"rent",propertyType:"commercial",status:"active",stage:"selection",budgetMax:"150000.00",areaMin:"50",areaMax:"150"}});
      await tx.task.create({data:{title:"ДЕМО: уточнить подбор",taskType:"call_or_contact",status:"planned",priority:"normal",dueAt:new Date(Date.now()+i*86400000),responsibleUserId:managerId,createdBy:managerId,needLinks:{create:{clientNeedId:need.id}},clientLinks:{create:{clientId:client.id}}}});
      await tx.property.create({data:{addressText:`ДЕМО: деловой квартал, дом ${i}`,propertyType:"commercial",operationType:"rent",sourceType:"agency_listing",status:"active",area:String(50+i*10),price:String(50000+i*5000),responsibleUserId:managerId,createdBy:managerId}});
    });
  }
}
