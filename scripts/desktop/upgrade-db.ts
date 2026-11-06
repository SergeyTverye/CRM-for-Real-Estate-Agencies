import { upgradeSqlite } from "./database-lifecycle";
if(process.env.CRM_DEPLOYMENT_MODE!=="desktop" || !process.env.DATABASE_URL?.startsWith("file:")) throw new Error("DESKTOP_DATABASE_REQUIRED");
upgradeSqlite(process.env.DATABASE_URL.slice(5)).then(()=>console.log("SQLITE_UPGRADE_VERIFIED")).catch(()=>{console.error("SQLITE_UPGRADE_FAILED_SNAPSHOT_RETAINED");process.exitCode=1;});
