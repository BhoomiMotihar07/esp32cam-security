/**
 * Device contract: the JSON shapes that cross the device <-> cloud boundary.
 * Mirrored by firmware/src/net/Messages.h and documented in docs/device-contract.md.
 * Timestamps are UNIX epoch seconds (integers) because the ESP32 builds them from NTP
 * and every byte counts against the IoT Hub F1 quota.
 */

export const DEVICE_STATES = ["DISARMED", "EXIT_COUNTDOWN", "ARMED", "ALARM"] as const;
export type DeviceState = (typeof DEVICE_STATES)[number];

/** Who or what caused the current arming state. */
export const ARM_SOURCES = ["app", "schedule", "auto_dark", "button", "telegram"] as const;
export type ArmSource = (typeof ARM_SOURCES)[number];

export const EVENT_TYPES = ["motion", "sound", "tamper_dark", "tamper_moved", "offline"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Sent every HEARTBEAT_INTERVAL_SEC. Must stay under 500 bytes. */
export interface HeartbeatMessage {
  kind: "heartbeat";
  deviceId: string;
  state: DeviceState;
  armSource: ArmSource | null;
  rssi: number;
  /** seconds since boot */
  uptime: number;
  /** esp_reset_reason() name, e.g. POWERON, BROWNOUT, PANIC, SW, WDT */
  resetReason: string;
  /** mean gray level 0-255 of the latest small frame */
  brightness: number;
  freeHeap?: number;
  /** version of the DeviceConfig the device is running, so the app can show "applied" */
  configVersion?: number;
  ts: number;
}

/** Sent immediately on every state-machine transition so the app does not wait for a heartbeat. */
export interface StateMessage {
  kind: "state";
  deviceId: string;
  state: DeviceState;
  armSource: ArmSource | null;
  /** present only in EXIT_COUNTDOWN */
  countdownEndsAt?: number;
  ts: number;
}

/** A detection. The photos are blob names already uploaded via the SAS flow. */
export interface EventMessage {
  kind: "event";
  deviceId: string;
  type: Exclude<EventType, "offline">;
  zone?: string;
  /** detector score: fraction of changed zone pixels, sound pulses / baseline, etc. */
  score: number;
  photoCount: number;
  photos: string[];
  ts: number;
}

/** Result of a `snapshot` command: one JPEG uploaded via SAS. */
export interface SnapshotMessage {
  kind: "snapshot";
  deviceId: string;
  blob: string;
  ts: number;
}

export type DeviceMessage = HeartbeatMessage | StateMessage | EventMessage | SnapshotMessage;

/** A rectangle on the snapshot, normalised 0..1 so it is resolution independent. */
export interface Zone {
  id: string;
  name: string;
  enabled: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScheduleEntry {
  /** 0 = Sunday ... 6 = Saturday */
  days: number[];
  /** "HH:MM" local time */
  armAt: string;
  disarmAt: string;
}

export interface Schedule {
  enabled: boolean;
  /** minutes east of UTC, e.g. 330 for IST; the device has no timezone database */
  tzOffsetMin: number;
  entries: ScheduleEntry[];
}

export interface DeviceConfig {
  version: number;
  zones: Zone[];
  /** fraction of pixels in a zone that must change between two consecutive frames (0.01 .. 0.5) */
  motionThreshold: number;
  /** 1 (least sensitive) .. 10 (most). Maps to the multiplier over the sound baseline. */
  soundSensitivity: number;
  /** mean brightness (0-255) below which the scene counts as dark */
  nightThreshold: number;
  autoArmWhenDark: boolean;
  exitDelaySec: number;
  schedule: Schedule;
}

export const DEFAULT_CONFIG: DeviceConfig = {
  version: 1,
  zones: [{ id: "z1", name: "Whole frame", enabled: true, x: 0, y: 0, w: 1, h: 1 }],
  motionThreshold: 0.08,
  soundSensitivity: 5,
  nightThreshold: 40,
  autoArmWhenDark: false,
  exitDelaySec: 30,
  schedule: { enabled: false, tzOffsetMin: 330, entries: [] },
};

/** Cloud-to-device commands. `ts` lets the device drop stale commands that IoT Hub queued while it was offline. */
export type DeviceCommand =
  | { cmd: "arm"; ts: number; source: ArmSource; requestId?: string }
  | { cmd: "disarm"; ts: number; source: ArmSource; requestId?: string }
  | { cmd: "snapshot"; ts: number; requestId?: string }
  | { cmd: "ack"; ts: number; requestId?: string }
  | { cmd: "ping"; ts: number; requestId?: string }
  | { cmd: "setConfig"; ts: number; config: DeviceConfig; requestId?: string };

export type CommandName = DeviceCommand["cmd"];

/** Timing constants shared by firmware, simulator and backend. */
export const TIMING = {
  HEARTBEAT_INTERVAL_SEC: 60,
  /** app shows OFFLINE after this many seconds without a heartbeat */
  OFFLINE_AFTER_SEC: 180,
  ALERT_REPEAT_SEC: 30,
  EXIT_DELAY_SEC: 30,
  BURST_PHOTOS: 3,
  BURST_GAP_MS: 300,
  /** device ignores commands older than this */
  COMMAND_MAX_AGE_SEC: 600,
  UPLOAD_SAS_MINUTES: 5,
  READ_SAS_MINUTES: 15,
} as const;

/** Blob naming: one folder per device so SAS scope and listing stay simple. */
export function photoBlobName(deviceId: string, ts: number, seq: number): string {
  return `${deviceId}/${ts}-${seq}.jpg`;
}

const BLOB_NAME_RE = /^[a-zA-Z0-9_-]{1,64}\/\d{1,12}-\d{1,3}\.jpg$/;
export function isValidPhotoBlobName(name: string): boolean {
  return BLOB_NAME_RE.test(name);
}

const DEVICE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
export function isValidDeviceId(id: string): boolean {
  return DEVICE_ID_RE.test(id);
}
