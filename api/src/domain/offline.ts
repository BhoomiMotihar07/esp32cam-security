/**
 * Offline detection, run by a one-minute timer. A device with no heartbeat for
 * OFFLINE_AFTER_SEC gets an `offline` event and one alert. The flag clears on the next heartbeat.
 */
import { TIMING } from "@esp32cam/shared";
import type { EventDoc } from "../ports/store.js";
import type { Services } from "../services.js";
import { notifyNewEvent } from "./alerts.js";
import { nowSec } from "../util.js";

export async function checkOfflineDevices(svc: Services, now = nowSec()): Promise<string[]> {
  const flagged: string[] = [];
  for (const device of await svc.store.listAllDevices()) {
    if (device.lastHeartbeatAt === undefined || device.offlineSince !== undefined) continue;
    if (now - device.lastHeartbeatAt <= TIMING.OFFLINE_AFTER_SEC) continue;

    device.offlineSince = now;
    const event: EventDoc = {
      id: `${now}-offline`,
      deviceId: device.deviceId,
      householdId: device.householdId,
      type: "offline",
      score: 0,
      photoCount: 0,
      photos: [],
      ts: now,
      receivedAt: now,
      alert: { acknowledged: false, repeatCount: 0, lastSentAt: now, telegramMessages: [] },
    };
    device.lastEvent = { type: "offline", ts: now };
    await svc.store.putEvent(event);
    await svc.store.putDevice(device);
    await notifyNewEvent(svc, event, device, now);
    flagged.push(device.deviceId);
  }
  return flagged;
}
