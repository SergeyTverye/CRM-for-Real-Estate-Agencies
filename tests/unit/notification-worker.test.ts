import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ standby:false, locked:true, due:new Date("2026-11-05T03:00:00Z"), owner:"u", open:true,
  transactions:0, lockQueries:0,
  rows:[] as { id:string; recipientUserId:string; sourceId:string; kind:string; dedupKey:string; state:string; triggerAt:Date; snoozedUntil:Date|null }[] }));
vi.mock("@/shared/config/env",()=>({ getConfig:()=>({ isReadOnlyInstance:state.standby,APP_TIMEZONE:"Asia/Novosibirsk" }) }));
vi.mock("@/shared/db/client",()=>({
  disconnectDb:vi.fn(),
  transaction:async (fn:(tx:unknown)=>Promise<unknown>)=>{state.transactions++;return fn({
    $queryRaw:async()=>{state.lockQueries++;return [{locked:state.locked}];},
    user:{findMany:async()=>[{id:"u",notificationPreference:{leadMinutes:15}},{id:"v",notificationPreference:{leadMinutes:0}}]},
    task:{findMany:async()=>state.open ? [{id:"t",responsibleUserId:state.owner,dueAt:state.due,createdAt:new Date("2026-11-01T03:00:00Z"),taskType:"call_or_contact",recurrenceKind:"none"}] : []},
    showing:{findMany:async()=>[]},agreement:{findMany:async()=>[]},calendarEvent:{findMany:async()=>[]},
    notification:{
      findMany:async()=>state.rows.filter(r=>r.state==="pending"),
      update:async({where,data}:{where:{id:string};data:Record<string,unknown>})=>Object.assign(state.rows.find(r=>r.id===where.id)!,data),
      createMany:async({data}:{data:typeof state.rows})=>{for(const r of data)if(!state.rows.some(old=>old.dedupKey===r.dedupKey))state.rows.push({...r,id:`n${state.rows.length}`,state:"pending",snoozedUntil:null});},
      updateMany:async({where}:{where:{triggerAt:{lte:Date}}})=>{
        let count=0;
        for(const r of state.rows)if(r.state==="pending"&&r.triggerAt<=where.triggerAt.lte&&(!r.snoozedUntil||r.snoozedUntil<=where.triggerAt.lte)){r.state="delivered";count++;}
        return{count};
      },
    },
  });},
}));
import { generateNotifications } from "@/modules/notifications/application/notification-generator";
describe("notification worker reconciliation (in-memory persistence contract)",()=>{
  beforeEach(()=>{state.rows=[];state.transactions=0;state.lockQueries=0;state.standby=false;state.locked=true;state.open=true;state.owner="u";state.due=new Date("2026-11-05T03:00Z");});
  it("catches up and never duplicates delivered rows across ticks",async()=>{
    const now=new Date("2026-11-06");
    expect((await generateNotifications(now)).delivered).toBe(2);
    expect((await generateNotifications(now)).delivered).toBe(0);
    expect(state.rows).toHaveLength(2);
  });
  it("dismisses the old pending deadline before delivering rescheduled reminders",async()=>{
    await generateNotifications(new Date("2026-11-04"));
    state.due=new Date("2026-11-07T03:00Z");
    await generateNotifications(new Date("2026-11-06"));
    expect(state.rows.filter(r=>r.kind==="task"&&r.state==="dismissed")).toHaveLength(1);
    const next=state.rows.find(r=>r.kind==="task"&&r.state==="pending")!;
    expect(next.triggerAt.toISOString()).toBe("2026-11-07T02:45:00.000Z");
  });
  it("keeps snooze across a worker tick and redelivers it only after the chosen instant",async()=>{
    await generateNotifications(new Date("2026-11-06"));
    const n=state.rows.find(r=>r.kind==="task")!;
    n.state="pending";n.snoozedUntil=new Date("2026-11-10");
    await generateNotifications(new Date("2026-11-08"));expect(n.state).toBe("pending");
    await generateNotifications(new Date("2026-11-11"));expect(n.state).toBe("delivered");
    expect(state.due.toISOString()).toBe("2026-11-05T03:00:00.000Z");
  });
  it("does no work on standby or without the advisory lock",async()=>{
    state.standby=true;expect(await generateNotifications()).toMatchObject({active:false,delivered:0});
    expect(state.transactions).toBe(0);
    state.standby=false;state.locked=false;expect(await generateNotifications()).toMatchObject({active:true,locked:false,delivered:0});
    expect(state.transactions).toBe(1);expect(state.lockQueries).toBe(1);
    expect(state.rows).toHaveLength(0);
  });
  it("dismisses pending notifications on completion or reassignment",async()=>{
    await generateNotifications(new Date("2026-11-04"));
    state.owner="v";await generateNotifications(new Date("2026-11-04"));
    expect(state.rows.filter(n=>n.recipientUserId==="u"&&n.kind==="task")[0]?.state).toBe("dismissed");
    expect(state.rows.find(n=>n.recipientUserId==="v"&&n.kind==="task")?.triggerAt).toEqual(state.due);
    state.open=false;await generateNotifications(new Date("2026-11-06"));
    expect(state.rows.filter(n=>n.state==="pending")).toHaveLength(0);
  });
});
