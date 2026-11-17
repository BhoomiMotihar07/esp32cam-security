/**
 * Device-to-cloud message handling. `deviceId` comes from the transport (IoT Hub's
 * iothub-connection-device-id system property, or the local route) and overrides whatever
 * the body claims, so one device cannot write another device's state.
 */
import {
  ARM_SOURCES, DEVICE_STATES, EVENT_TYPES, isValidPhotoBlobName, type DeviceMessage,
} from "@esp32cam/shared";
import type { DeviceDoc, EventDoc } from "../ports/store.js";
import type { Services } from "../services.js";
import { newDeviceDoc } from "./devices.js";
import { acknowledgeEvent, notifyNewEvent } from "./alerts.js";
import { nowSec } from "../util.js";

export type IngestResult = { accepted: true; kind: DeviceMessage["kind"] } | { accepted: false; reason: string };

export async function ingestMessage(svc: Services, deviceId: string, raw: unknown, now = nowSec()): Promise<IngestResult> {
  const parsed = parseMessage(raw, deviceId);
  if (!parsed.ok) {
    svc.log.warn("dropped device message", { deviceId, reason: parsed.reason });
    return { accepted: false, reason: parsed.reason };
  }
  const msg = parsed.message;
  const device = (await svc.store.getDevice(deviceId)) ?? newDeviceDoc(deviceId, now);

  switch (msg.kind) {
    case "heartbeat": {
      const wasOffline = device.offlineSince !== undefined;
      Object.assign(device, {
        state: msg.state, armSource: msg.armSource, rssi: msg.rssi, uptime: msg.uptime, resetReason: msg.resetReason,
        brightness: msg.brightness, freeHeap: msg.freeHeap, appliedConfigVersion: msg.configVersion, lastHeartbeatAt: now,
      });
      if (msg.state !== "EXIT_COUNTDOWN") device.countdownEndsAt = undefined;
      delete device.offlineSince;
      await svc.store.putDevice(device);
      if (wasOffline) await clearOfflineAlert(svc, device, now);
      break;
    }
    case "state": {
      device.state = msg.state;
      device.armSource = msg.armSource;
      device.countdownEndsAt = msg.state === "EXIT_COUNTDOWN" ? msg.countdownEndsAt : undefined;
      device.lastStateAt = now;
      await svc.store.putDevice(device);
      break;
    }
    case "event": {
      const event: EventDoc = {
        id: `${msg.ts}-${msg.type}`,
        deviceId,
        householdId: device.householdId,
        type: msg.type,
        zone: msg.zone,
        score: msg.score,
        photoCount: msg.photoCount,
        photos: msg.photos,
        ts: msg.ts,
        receivedAt: now,
        alert: { acknowledged: false, repeatCount: 0, lastSentAt: now, telegramMessages: [] },
      };
      await svc.store.putEvent(event);
      device.lastEvent = { type: msg.type, zone: msg.zone, ts: msg.ts };
      await svc.store.putDevice(device);
      await notifyNewEvent(svc, event, device, now);
      break;
    }
    case "snapshot": {
      device.lastSnapshotBlob = msg.blob;
      device.lastSnapshotAt = msg.ts;
      await svc.store.putDevice(device);
      break;
    }
  }
  return { accepted: true, kind: msg.kind };
}

/** A returning heartbeat auto-acknowledges the open offline event and tells the household. */
async function clearOfflineAlert(svc: Services, device: DeviceDoc, now: number): Promise<void> {
  const open = (await svc.store.listEvents(device.deviceId, { type: "offline", limit: 1 }))[0];
  if (open && !open.alert.acknowledged) await acknowledgeEvent(svc, open, "system (back online)", now);
}

type Parsed = { ok: true; message: DeviceMessage } | { ok: false; reason: string };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown, max = 128): v is string => typeof v === "string" && v.length <= max;

/** Hand-rolled validation: the device is a constrained C++ program, so be strict but forgiving about extra fields. */
export function parseMessage(raw: unknown, deviceId: string): Parsed {
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: "not an object" };
  const m = raw as Record<string, unknown>;
  if (!isNum(m["ts"]) || m["ts"] < 1_600_000_000) return { ok: false, reason: "bad ts" };
  const ts = Math.floor(m["ts"]);

  switch (m["kind"]) {
    case "heartbeat": {
      if (!DEVICE_STATES.includes(m["state"] as never)) return { ok: false, reason: "bad state" };
      if (m["armSource"] !== null && m["armSource"] !== undefined && !ARM_SOURCES.includes(m["armSource"] as never)) return { ok: false, reason: "bad armSource" };
      if (!isNum(m["rssi"]) || !isNum(m["uptime"]) || !isNum(m["brightness"]) || !isStr(m["resetReason"], 32)) return { ok: false, reason: "bad heartbeat fields" };
      return {
        ok: true,
        message: {
          kind: "heartbeat", deviceId, state: m["state"] as never, armSource: (m["armSource"] ?? null) as never, rssi: m["rssi"], uptime: m["uptime"],
          resetReason: m["resetReason"], brightness: m["brightness"], freeHeap: isNum(m["freeHeap"]) ? m["freeHeap"] : undefined,
          configVersion: isNum(m["configVersion"]) ? m["configVersion"] : undefined, ts,
        },
      };
    }
    case "state": {
      if (!DEVICE_STATES.includes(m["state"] as never)) return { ok: false, reason: "bad state" };
      if (m["armSource"] !== null && m["armSource"] !== undefined && !ARM_SOURCES.includes(m["armSource"] as never)) return { ok: false, reason: "bad armSource" };
      return { ok: true, message: { kind: "state", deviceId, state: m["state"] as never, armSource: (m["armSource"] ?? null) as never, countdownEndsAt: isNum(m["countdownEndsAt"]) ? m["countdownEndsAt"] : undefined, ts } };
    }
    case "event": {
      if (!EVENT_TYPES.includes(m["type"] as never) || m["type"] === "offline") return { ok: false, reason: "bad event type" };
      if (!isNum(m["score"])) return { ok: false, reason: "bad score" };
      const photos = Array.isArray(m["photos"]) ? m["photos"] : [];
      if (photos.length > 10 || !photos.every((p) => typeof p === "string" && isValidPhotoBlobName(p) && p.startsWith(`${deviceId}/`))) return { ok: false, reason: "bad photos" };
      const zone = isStr(m["zone"], 24) ? m["zone"] : undefined;
      return { ok: true, message: { kind: "event", deviceId, type: m["type"] as never, zone, score: m["score"], photoCount: isNum(m["photoCount"]) ? m["photoCount"] : photos.length, photos: photos as string[], ts } };
    }
    case "snapshot": {
      if (!isStr(m["blob"]) || !isValidPhotoBlobName(m["blob"]) || !m["blob"].startsWith(`${deviceId}/`)) return { ok: false, reason: "bad blob" };
      return { ok: true, message: { kind: "snapshot", deviceId, blob: m["blob"], ts } };
    }
    default:
      return { ok: false, reason: "unknown kind" };
  }
}
