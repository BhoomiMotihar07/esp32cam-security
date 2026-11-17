/** Device views, commands and configuration. */
import {
  DEFAULT_CONFIG, TIMING, isValidDeviceId, isValidHHMM, type ArmSource, type DeviceCommand, type DeviceConfig, type DeviceView, type Zone,
} from "@esp32cam/shared";
import type { ConfigDoc, DeviceDoc } from "../ports/store.js";
import type { Services } from "../services.js";
import { HttpError } from "../http/respond.js";
import { requireArray, requireBoolean, requireNumber, requireObject, requireString } from "../http/validate.js";
import { nowSec, sha256Hex } from "../util.js";

export function isOffline(device: DeviceDoc, now: number): boolean {
  if (device.lastHeartbeatAt === undefined) return true;
  return now - device.lastHeartbeatAt > TIMING.OFFLINE_AFTER_SEC;
}

export function toDeviceView(device: DeviceDoc, config: ConfigDoc | null, now = nowSec()): DeviceView {
  return {
    deviceId: device.deviceId,
    name: device.name,
    householdId: device.householdId,
    state: device.state,
    armSource: device.armSource,
    countdownEndsAt: device.countdownEndsAt,
    offline: isOffline(device, now),
    lastHeartbeatAt: device.lastHeartbeatAt,
    lastStateAt: device.lastStateAt,
    rssi: device.rssi,
    uptime: device.uptime,
    resetReason: device.resetReason,
    brightness: device.brightness,
    freeHeap: device.freeHeap,
    configVersion: config?.config.version,
    appliedConfigVersion: device.appliedConfigVersion,
    lastEvent: device.lastEvent,
    lastSnapshotBlob: device.lastSnapshotBlob,
    lastSnapshotAt: device.lastSnapshotAt,
  };
}

export function newDeviceDoc(deviceId: string, now: number): DeviceDoc {
  return { id: deviceId, deviceId, householdId: "", name: deviceId, uploadKeyHash: "", state: "DISARMED", armSource: null, createdAt: now };
}

/** An owner attaches a device to the household and sets the key it will use for photo uploads. */
export async function claimDevice(svc: Services, householdId: string, body: unknown): Promise<DeviceDoc> {
  const o = requireObject(body);
  const deviceId = requireString(o, "deviceId", { max: 64 });
  if (!isValidDeviceId(deviceId)) throw new HttpError(400, "invalid_field", "deviceId may contain letters, digits, - and _");
  const name = requireString(o, "name", { max: 60 });
  const uploadKey = requireString(o, "uploadKey", { min: 8, max: 128 });
  const now = nowSec();
  const existing = (await svc.store.getDevice(deviceId)) ?? newDeviceDoc(deviceId, now);
  if (existing.householdId && existing.householdId !== householdId) throw new HttpError(409, "device_claimed", "this device belongs to another household");
  const doc: DeviceDoc = { ...existing, householdId, name, uploadKeyHash: sha256Hex(uploadKey) };
  await svc.store.putDevice(doc);
  if (!(await svc.store.getConfig(deviceId))) {
    await svc.store.putConfig({ id: deviceId, deviceId, config: DEFAULT_CONFIG, updatedAt: now, updatedBy: "default" });
  }
  return doc;
}

export async function renameDevice(svc: Services, device: DeviceDoc, body: unknown): Promise<DeviceDoc> {
  const name = requireString(requireObject(body), "name", { max: 60 });
  const doc = { ...device, name };
  await svc.store.putDevice(doc);
  return doc;
}

export type UserCommand = "arm" | "disarm" | "snapshot" | "ping";

export function buildCommand(cmd: UserCommand, source: ArmSource, requestId: string): DeviceCommand {
  const ts = nowSec();
  switch (cmd) {
    case "arm": return { cmd: "arm", ts, source, requestId };
    case "disarm": return { cmd: "disarm", ts, source, requestId };
    case "snapshot": return { cmd: "snapshot", ts, requestId };
    case "ping": return { cmd: "ping", ts, requestId };
  }
}

export async function getOrCreateConfig(svc: Services, deviceId: string): Promise<ConfigDoc> {
  const existing = await svc.store.getConfig(deviceId);
  if (existing) return existing;
  const doc: ConfigDoc = { id: deviceId, deviceId, config: DEFAULT_CONFIG, updatedAt: nowSec(), updatedBy: "default" };
  await svc.store.putConfig(doc);
  return doc;
}

/** Validates a full DeviceConfig from the app, bumps the version, stores it and pushes it to the device. */
export async function updateConfig(svc: Services, deviceId: string, body: unknown, updatedBy: string): Promise<ConfigDoc> {
  const current = await getOrCreateConfig(svc, deviceId);
  const config = parseConfig(body, current.config.version + 1);
  const doc: ConfigDoc = { id: deviceId, deviceId, config, updatedAt: nowSec(), updatedBy };
  await svc.store.putConfig(doc);
  await svc.link.sendCommand(deviceId, { cmd: "setConfig", ts: nowSec(), config });
  return doc;
}

export function parseConfig(body: unknown, version: number): DeviceConfig {
  const o = requireObject(body);
  const zones: Zone[] = requireArray(o, "zones", 8).map((z, i) => {
    const zo = requireObject(z, `zones[${i}]`);
    const zone: Zone = {
      id: requireString(zo, "id", { max: 16, pattern: /^[a-zA-Z0-9_-]+$/ }),
      name: requireString(zo, "name", { max: 24 }),
      enabled: requireBoolean(zo, "enabled"),
      x: requireNumber(zo, "x", 0, 1),
      y: requireNumber(zo, "y", 0, 1),
      w: requireNumber(zo, "w", 0.02, 1),
      h: requireNumber(zo, "h", 0.02, 1),
    };
    if (zone.x + zone.w > 1.0001 || zone.y + zone.h > 1.0001) throw new HttpError(400, "invalid_field", `zone ${zone.id} exceeds the frame`);
    return zone;
  });
  if (new Set(zones.map((z) => z.id)).size !== zones.length) throw new HttpError(400, "invalid_field", "zone ids must be unique");

  const scheduleObj = requireObject(o["schedule"], "schedule");
  const entries = requireArray(scheduleObj, "entries", 14).map((e, i) => {
    const eo = requireObject(e, `schedule.entries[${i}]`);
    const days = requireArray(eo, "days", 7).map((d) => {
      if (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d > 6) throw new HttpError(400, "invalid_field", "days must be 0..6");
      return d;
    });
    const armAt = requireString(eo, "armAt", { max: 5 });
    const disarmAt = requireString(eo, "disarmAt", { max: 5 });
    if (!isValidHHMM(armAt) || !isValidHHMM(disarmAt)) throw new HttpError(400, "invalid_field", "times must be HH:MM");
    return { days, armAt, disarmAt };
  });

  return {
    version,
    zones,
    motionThreshold: requireNumber(o, "motionThreshold", 0.01, 0.5),
    soundSensitivity: requireNumber(o, "soundSensitivity", 1, 10),
    nightThreshold: requireNumber(o, "nightThreshold", 0, 255),
    autoArmWhenDark: requireBoolean(o, "autoArmWhenDark"),
    exitDelaySec: requireNumber(o, "exitDelaySec", 0, 300),
    schedule: {
      enabled: requireBoolean(scheduleObj, "enabled"),
      tzOffsetMin: requireNumber(scheduleObj, "tzOffsetMin", -720, 840),
      entries,
    },
  };
}
