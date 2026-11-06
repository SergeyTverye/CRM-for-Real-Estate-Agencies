import { expect, it } from "vitest";
import { dueBackupSlot } from "@/modules/desktop-backup/domain/schedule";
import { defaultSettings } from "@/modules/desktop-backup/domain/settings";
it("coalesces months of missed intervals to one local slot, then stays idle", () => {
  const s = { ...defaultSettings().schedule, enabled: true };
  const now = new Date("2026-11-06T12:05:00Z");
  const slot = dueBackupSlot(s, now, "2026-01-01T19:00|Asia/Novosibirsk|daily");
  expect(slot).toBe("2026-11-06T19:00|Asia/Novosibirsk|daily");
  expect(dueBackupSlot(s, now, slot)).toBeNull();
  expect(dueBackupSlot({ ...s, enabled: false }, now, null)).toBeNull();
});
it("uses previous day before due time; weekly anchor and DST repeated hour are stable", () => {
  const s = { ...defaultSettings().schedule, enabled: true };
  expect(dueBackupSlot(s, new Date("2026-11-06T11:59:00Z"), null)).toContain("2026-11-05");
  expect(dueBackupSlot({ ...s, frequency: "weekly", weekday: 1 }, new Date("2026-11-06T12:01:00Z"), null)).toContain("2026-11-02");
  const dst = { ...s, timeZone: "America/New_York", hour: 1, minute: 0 };
  const first = dueBackupSlot(dst, new Date("2026-11-01T05:30:00Z"), null);
  expect(dueBackupSlot(dst, new Date("2026-11-01T06:30:00Z"), first)).toBeNull();
});
