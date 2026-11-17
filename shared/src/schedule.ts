/**
 * Weekly schedule evaluation, shared by simulator and backend (the firmware mirrors it).
 * Returns the state the schedule wants right now, or null when no entry covers this minute.
 * Entries may cross midnight (armAt 22:00, disarmAt 06:00): the entry's day is the arm day.
 */
import type { Schedule } from "./device-contract.js";

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function isValidHHMM(s: string): boolean {
  return toMinutes(s) !== null;
}

export function scheduleWants(schedule: Schedule, nowEpochSec: number): "armed" | "disarmed" | null {
  if (!schedule.enabled || schedule.entries.length === 0) return null;
  const local = new Date((nowEpochSec + schedule.tzOffsetMin * 60) * 1000);
  const day = local.getUTCDay();
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const yesterday = (day + 6) % 7;

  for (const entry of schedule.entries) {
    const arm = toMinutes(entry.armAt);
    const disarm = toMinutes(entry.disarmAt);
    if (arm === null || disarm === null) continue;
    if (arm < disarm) {
      if (entry.days.includes(day) && minute >= arm && minute < disarm) return "armed";
    } else {
      // crosses midnight: armed from armAt today, or before disarmAt if armed yesterday
      if (entry.days.includes(day) && minute >= arm) return "armed";
      if (entry.days.includes(yesterday) && minute < disarm) return "armed";
    }
  }
  return "disarmed";
}
