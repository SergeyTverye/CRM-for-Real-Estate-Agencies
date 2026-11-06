import { createDesktopSafetySnapshot } from "./upgrade";
createDesktopSafetySnapshot().then(() => console.log("LOCAL_SAFETY_BACKUP_COMPLETE"), () => { console.error("LOCAL_SAFETY_BACKUP_FAILED"); process.exitCode = 1; });
