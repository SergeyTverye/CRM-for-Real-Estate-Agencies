import fs from 'node:fs';
try {
  const pid = Number(fs.readFileSync('/tmp/crm-worker.pid', 'utf8'));
  process.kill(pid, 0);
  process.exit(0);
} catch { process.exit(1); }
