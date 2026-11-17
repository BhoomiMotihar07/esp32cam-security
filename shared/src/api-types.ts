/** Shapes returned by the Functions HTTP API and consumed by the app. */
import type { ArmSource, DeviceConfig, DeviceState, EventType } from "./device-contract.js";
import type { Role } from "./roles.js";

export interface DeviceView {
  deviceId: string;
  name: string;
  householdId: string;
  state: DeviceState;
  armSource: ArmSource | null;
  countdownEndsAt?: number;
  /** true when no heartbeat for TIMING.OFFLINE_AFTER_SEC */
  offline: boolean;
  lastHeartbeatAt?: number;
  lastStateAt?: number;
  rssi?: number;
  uptime?: number;
  resetReason?: string;
  brightness?: number;
  freeHeap?: number;
  configVersion?: number;
  appliedConfigVersion?: number;
  lastEvent?: { type: EventType; zone?: string; ts: number };
  lastSnapshotBlob?: string;
  lastSnapshotAt?: number;
}

export interface EventView {
  id: string;
  deviceId: string;
  type: EventType;
  zone?: string;
  score: number;
  photoCount: number;
  photos: string[];
  ts: number;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: number;
  repeatCount: number;
}

export interface PhotoUrl {
  blob: string;
  url: string;
  expiresAt: number;
}

export interface UserView {
  id: string;
  email: string;
  householdId: string;
  role: Role;
}

export interface MemberView {
  userId: string;
  email: string;
  role: Role;
  joinedAt: number;
}

export interface InviteView {
  code: string;
  role: Role;
  createdAt: number;
  expiresAt: number;
  usedBy?: string;
}

export interface TelegramLinkView {
  chatId: string;
  title: string;
  linkedAt: number;
}

export interface AuthResponse {
  token: string;
  user: UserView;
}

export interface ApiError {
  error: string;
  detail?: string;
}

export type { DeviceConfig };
