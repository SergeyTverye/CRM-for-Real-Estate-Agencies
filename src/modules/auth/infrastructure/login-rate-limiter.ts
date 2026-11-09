
interface Entry {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
}

export class LoginRateLimiter {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly maxFailures: number,
    private readonly lockMs: number,
    private readonly windowMs: number = lockMs,
  ) {}

  private keys(login: string, ip: string | null): string[] {
    return [`l:${login}`, `li:${login}|${ip ?? "-"}`];
  }

  isLocked(login: string, ip: string | null, now = Date.now()): boolean {
    return this.keys(login, ip).some((k) => (this.entries.get(k)?.lockedUntil ?? 0) > now);
  }

  
  delayFor(login: string, ip: string | null): number {
    const failures = Math.max(...this.keys(login, ip).map((k) => this.entries.get(k)?.failures ?? 0));
    return Math.min(250 * 2 ** Math.max(0, failures - 1), 4000);
  }

  recordFailure(login: string, ip: string | null, now = Date.now()): void {
    for (const k of this.keys(login, ip)) {
      const e = this.entries.get(k);
      if (!e || now - e.firstFailureAt > this.windowMs) {
        this.entries.set(k, { failures: 1, firstFailureAt: now, lockedUntil: 0 });
        continue;
      }
      e.failures += 1;
      
      const limit = k.startsWith("l:") ? this.maxFailures * 3 : this.maxFailures;
      if (e.failures >= limit) e.lockedUntil = now + this.lockMs;
    }
    if (this.entries.size > 10_000) this.prune(now);
  }

  recordSuccess(login: string, ip: string | null): void {
    for (const k of this.keys(login, ip)) this.entries.delete(k);
  }

  private prune(now: number): void {
    for (const [k, e] of this.entries) if (e.lockedUntil < now && now - e.firstFailureAt > this.windowMs) this.entries.delete(k);
  }

  reset(): void {
    this.entries.clear();
  }
}
