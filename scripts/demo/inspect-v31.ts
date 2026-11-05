import { db, demoId } from "./context";
async function main() {
  console.log({ tasks: await db.task.count({where:{description:{contains:"DEMO v3.1"}}}), checklist: await db.taskChecklistItem.count(), calls: await db.leadRequest.count({where:{id:demoId("v31:call:0")}}), collections: await db.propertyCollection.count({where:{name:{startsWith:"DEMO"}}}), templates: await db.documentTemplate.count({where:{code:{startsWith:"demo_v31"}}}), chat:await db.aiChatSession.count({where:{id:demoId("v31:chat")}}) });
}
main().catch(e=>console.log({code:e.code, message:String(e.message).split("\n").slice(-3).join(" ")})).finally(()=>db.$disconnect());
