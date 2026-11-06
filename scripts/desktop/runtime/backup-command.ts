import { executeDesktopBackupRequest, createClosingBackupRequest } from "../../../src/modules/desktop-backup/application/desktop-coordinator";
const id = process.argv[2];
if (id === "--on-close") createClosingBackupRequest().catch(() => { console.error("CLOSING_BACKUP_FAILED"); process.exitCode = 1; });
else if (!id) process.exitCode = 1;
else executeDesktopBackupRequest(id).then(() => console.log("BACKUP_COMMAND_FINISHED"), () => { console.error("BACKUP_COMMAND_FAILED"); process.exitCode = 1; });
