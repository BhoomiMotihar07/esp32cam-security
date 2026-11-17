import { describe, expect, it } from "vitest";
import { scheduleWants } from "../src/schedule.js";
import type { Schedule } from "../src/device-contract.js";

// 2026-11-16 is a Monday. Build epoch seconds for IST (UTC+5:30) wall-clock times.
const IST = 330;
const istEpoch = (hh: number, mm: number, dayOffset = 0) =>
  Math.floor(Date.UTC(2026, 10, 16 + dayOffset, hh, mm) / 1000) - IST * 60;

const nightly: Schedule = { enabled: true, tzOffsetMin: IST, entries: [{ days: [1, 2, 3, 4, 5], armAt: "22:00", disarmAt: "06:00" }] };

describe("weekly schedule", () => {
  it("returns null when disabled or empty", () => {
    expect(scheduleWants({ ...nightly, enabled: false }, istEpoch(23, 0))).toBeNull();
    expect(scheduleWants({ ...nightly, entries: [] }, istEpoch(23, 0))).toBeNull();
  });

  it("arms inside a window that crosses midnight and disarms outside it", () => {
    expect(scheduleWants(nightly, istEpoch(23, 0))).toBe("armed"); // Monday 23:00
    expect(scheduleWants(nightly, istEpoch(5, 59, 1))).toBe("armed"); // Tuesday 05:59, armed since Monday
    expect(scheduleWants(nightly, istEpoch(6, 0, 1))).toBe("disarmed");
    expect(scheduleWants(nightly, istEpoch(12, 0))).toBe("disarmed");
  });

  it("respects the day list (Sunday evening is not in Mon-Fri)", () => {
    expect(scheduleWants(nightly, istEpoch(23, 0, -1))).toBe("disarmed"); // Sunday 23:00
    expect(scheduleWants(nightly, istEpoch(5, 0, 6))).toBe("disarmed"); // Sunday 05:00 after Saturday
  });

  it("handles same-day windows", () => {
    const office: Schedule = { enabled: true, tzOffsetMin: IST, entries: [{ days: [1], armAt: "09:00", disarmAt: "18:00" }] };
    expect(scheduleWants(office, istEpoch(8, 59))).toBe("disarmed");
    expect(scheduleWants(office, istEpoch(9, 0))).toBe("armed");
    expect(scheduleWants(office, istEpoch(17, 59))).toBe("armed");
    expect(scheduleWants(office, istEpoch(18, 0))).toBe("disarmed");
  });
});
