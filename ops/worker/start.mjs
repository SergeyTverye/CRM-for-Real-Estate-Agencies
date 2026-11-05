import { spawn } from 'node:child_process';
import fs from 'node:fs';
const child = spawn('/app/node_modules/.bin/tsx', ['src/worker/notifications-worker.ts'], { stdio: 'inherit' });
fs.writeFileSync('/tmp/crm-worker.pid', String(child.pid), { mode: 0o600 });
console.log(JSON.stringify({ level: 30, event: 'notifications.worker_started', pid: child.pid }));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('error', () => process.exit(1));
child.on('exit', code => { fs.rmSync('/tmp/crm-worker.pid', { force: true }); process.exit(code ?? 1); });
