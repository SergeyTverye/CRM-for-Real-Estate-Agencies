import { readFileSync } from "node:fs";
import { it, expect, beforeEach } from "vitest";
import { db, resetDatabase, seedBase } from "../helpers/fixtures";
beforeEach(resetDatabase);
it("PostgreSQL context CHECK upgrade preserves populated sessions/messages/actions", async () => {
 const users=await seedBase();
 const s=await db.aiChatSession.create({data:{ownerUserId:users.manager.userId,title:"Synthetic",contextType:"none"}});
 const m=await db.aiChatMessage.create({data:{sessionId:s.id,role:"user",content:"synthetic"}});
 const a=await db.aiPendingAction.create({data:{sessionId:s.id,actionType:"task",payload:{}}});
 // sqlite upgrade is separately verified through both supported runners in unit tests.
 if(process.env.CRM_DEPLOYMENT_MODE!=="desktop") await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe(`ALTER TABLE ai_chat_sessions DROP CONSTRAINT ai_chat_sessions_context_type_check, DROP CONSTRAINT ai_chat_sessions_context_check`);
  await tx.$executeRawUnsafe(`ALTER TABLE ai_chat_sessions ADD CONSTRAINT ai_chat_sessions_context_type_check CHECK(context_type IN ('client','need','collection','none')), ADD CONSTRAINT ai_chat_sessions_context_check CHECK((context_type='none' AND context_id IS NULL) OR (context_type<>'none' AND context_id IS NOT NULL))`);
  const sql=readFileSync("prisma/migrations/20261109003000_ai_screen_context/migration.sql","utf8");
  for(const statement of sql.split(";").filter(v=>v.trim())) await tx.$executeRawUnsafe(statement);
 });
 expect((await db.aiChatMessage.findUniqueOrThrow({where:{id:m.id}})).sessionId).toBe(s.id);
 expect((await db.aiPendingAction.findUniqueOrThrow({where:{id:a.id}})).sessionId).toBe(s.id);
 await db.aiChatSession.update({where:{id:s.id},data:{contextType:"today"}});
 await db.aiChatSession.update({where:{id:s.id},data:{contextType:"task",contextId:a.id}});
 await expect(db.aiChatSession.update({where:{id:s.id},data:{contextType:"reports"}})).rejects.toThrow();
});
