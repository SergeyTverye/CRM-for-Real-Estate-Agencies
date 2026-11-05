import { randomUUID } from "node:crypto";
import { beforeEach, expect, it } from "vitest";
import { db, seedBase, resetDatabase, makeClient, sessionCookieFor, apiRequest, routeParams, type TestUsers } from "../helpers/fixtures";
import { createTask, completeTask } from "@/modules/tasks/application/task-service";
import { saveChecklistItem, listChecklist } from "@/modules/tasks/application/checklist-service";
import { bulkCreateTasks } from "@/modules/tasks/application/bulk-task-service";
import { aggregatePlanner } from "@/modules/calendar/application/planner-service";
import { GET, POST } from "@/app/api/v1/tasks/[id]/checklist/route";
import { PATCH } from "@/app/api/v1/tasks/[id]/checklist/[itemId]/route";
let users: TestUsers;
beforeEach(async () => { await resetDatabase(); users = await seedBase(); });
it("denies foreign checklist and task completion through direct API and application", async () => {
  const t = await createTask(users.realtor1,{ title:"PRIVATE_TASK",taskType:"other",dueAt:new Date().toISOString() });
  const item = await saveChecklistItem(users.realtor1,t.id,{ title:"SECRET_CHECKLIST" });
  const row = (await listChecklist(users.realtor1,t.id)).items[0]!;
  const cookie = await sessionCookieFor(users.realtor2);
  const path = `/api/v1/tasks/${t.id}/checklist`;
  for (const response of [await GET(apiRequest("GET",path,{ cookie }),routeParams({ id:t.id })),await POST(apiRequest("POST",path,{ cookie,body:{ title:"Attempt" } }),routeParams({ id:t.id })),await PATCH(apiRequest("PATCH",`${path}/${item.id}`,{ cookie,body:{ title:"Attempt",expectedUpdatedAt:row.updatedAt.toISOString() } }),routeParams({ id:t.id,itemId:item.id }))]) {
    expect(response.status).toBe(404); expect(await response.text()).not.toMatch(/PRIVATE|SECRET/);
  }
  const task = await db.task.findUniqueOrThrow({ where:{ id:t.id } });
  await expect(completeTask(users.realtor2,t.id,{ expectedUpdatedAt:task.updatedAt.toISOString(),confirmOpenRequired:true })).rejects.toMatchObject({ code:"NOT_FOUND" });
});
it("cannot use own parent with foreign checklist item or foreign client batch/filter", async () => {
  const a = await createTask(users.realtor1,{ title:"A",taskType:"other",dueAt:new Date().toISOString() });
  const b = await createTask(users.realtor2,{ title:"B",taskType:"other",dueAt:new Date().toISOString() });
  const item = await saveChecklistItem(users.realtor1,a.id,{ title:"PRIVATE" });
  await expect(saveChecklistItem(users.realtor2,b.id,{ title:"Attempt",expectedUpdatedAt:new Date().toISOString() },item.id)).rejects.toMatchObject({ code:"NOT_FOUND" });
  const c = await makeClient(users.realtor1);
  await expect(bulkCreateTasks(users.realtor2,{ clientIds:[c.id],idempotencyKey:randomUUID(),task:{ title:"Attempt",taskType:"other",dueAt:new Date().toISOString() } })).rejects.toMatchObject({ code:"NOT_FOUND" });
  await expect(aggregatePlanner(users.realtor2,{ from:"2026-11-01T00:00Z",to:"2027-01-31T00:00Z",clientId:c.id })).rejects.toMatchObject({ code:"NOT_FOUND" });
});
