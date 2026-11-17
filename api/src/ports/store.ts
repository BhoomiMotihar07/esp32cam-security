/**
 * Persistence port. Two adapters implement it: adapters/memory-store.ts (local mode, JSON file)
 * and adapters/cosmos-store.ts (Cosmos DB). The domain layer only sees this interface.
 *
 * Cosmos layout (containers / partition keys):
 *   devices  /deviceId      events /deviceId      config /deviceId
 *   users    /householdId   (docs discriminated by `type`: user, household, invite, telegramLink, linkCode, pushSub)
 */
import type { ArmSource, DeviceConfig, DeviceState, EventType, Role } from "@esp32cam/shared";

export interface DeviceDoc {
  id: string; // = deviceId
  deviceId: string;
  /** "" until an owner claims the device from the app */
  householdId: string;
  name: string;
  /** sha256 of the key the device presents on GET /upload-url; "" until claimed */
  uploadKeyHash: string;
  state: DeviceState;
  armSource: ArmSource | null;
  countdownEndsAt?: number;
  lastHeartbeatAt?: number;
  lastStateAt?: number;
  rssi?: number;
  uptime?: number;
  resetReason?: string;
  brightness?: number;
  freeHeap?: number;
  appliedConfigVersion?: number;
  /** set by the offline timer; cleared by the next heartbeat */
  offlineSince?: number;
  lastEvent?: { type: EventType; zone?: string; ts: number };
  lastSnapshotBlob?: string;
  lastSnapshotAt?: number;
  createdAt: number;
}

export interface ConfigDoc {
  id: string; // = deviceId
  deviceId: string;
  config: DeviceConfig;
  updatedAt: number;
  updatedBy: string;
}

export interface AlertState {
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: number;
  repeatCount: number;
  lastSentAt: number;
  /** Telegram message ids per chat, so the ack can edit the buttons away */
  telegramMessages: { chatId: string; messageId: number }[];
}

export interface EventDoc {
  id: string;
  deviceId: string;
  householdId: string;
  type: EventType;
  zone?: string;
  score: number;
  photoCount: number;
  photos: string[];
  ts: number;
  receivedAt: number;
  alert: AlertState;
}

export interface UserDoc {
  type: "user";
  id: string;
  householdId: string;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: number;
}

export interface HouseholdDoc {
  type: "household";
  id: string;
  householdId: string; // = id, keeps the partition key uniform
  name: string;
  ownerId: string;
  createdAt: number;
}

export interface InviteDoc {
  type: "invite";
  id: string; // = code
  householdId: string;
  code: string;
  role: Role;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  usedBy?: string;
  usedAt?: number;
}

export interface TelegramLinkDoc {
  type: "telegramLink";
  id: string; // = chatId
  householdId: string;
  chatId: string;
  userId: string;
  title: string;
  linkedAt: number;
}

export interface LinkCodeDoc {
  type: "linkCode";
  id: string; // = code
  householdId: string;
  code: string;
  userId: string;
  expiresAt: number;
}

export interface PushSubscriptionDoc {
  type: "pushSub";
  id: string;
  householdId: string;
  userId: string;
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  createdAt: number;
}

export interface EventQuery {
  type?: EventType;
  /** return events with ts strictly before this (pagination cursor) */
  before?: number;
  limit: number;
}

export interface Store {
  getDevice(deviceId: string): Promise<DeviceDoc | null>;
  listDevices(householdId: string): Promise<DeviceDoc[]>;
  listAllDevices(): Promise<DeviceDoc[]>;
  putDevice(doc: DeviceDoc): Promise<void>;

  getConfig(deviceId: string): Promise<ConfigDoc | null>;
  putConfig(doc: ConfigDoc): Promise<void>;

  getEvent(deviceId: string, id: string): Promise<EventDoc | null>;
  putEvent(doc: EventDoc): Promise<void>;
  listEvents(deviceId: string, q: EventQuery): Promise<EventDoc[]>;
  /** events whose alert is not acknowledged, newest first (feeds the repeat timer) */
  listUnacknowledgedEvents(): Promise<EventDoc[]>;

  getUser(id: string): Promise<UserDoc | null>;
  getUserByEmail(email: string): Promise<UserDoc | null>;
  putUser(doc: UserDoc): Promise<void>;
  deleteUser(id: string, householdId: string): Promise<void>;
  listMembers(householdId: string): Promise<UserDoc[]>;

  getHousehold(id: string): Promise<HouseholdDoc | null>;
  putHousehold(doc: HouseholdDoc): Promise<void>;

  getInvite(code: string): Promise<InviteDoc | null>;
  putInvite(doc: InviteDoc): Promise<void>;
  listInvites(householdId: string): Promise<InviteDoc[]>;

  getTelegramLink(chatId: string): Promise<TelegramLinkDoc | null>;
  listTelegramLinks(householdId: string): Promise<TelegramLinkDoc[]>;
  putTelegramLink(doc: TelegramLinkDoc): Promise<void>;
  deleteTelegramLink(chatId: string, householdId: string): Promise<void>;

  getLinkCode(code: string): Promise<LinkCodeDoc | null>;
  putLinkCode(doc: LinkCodeDoc): Promise<void>;
  deleteLinkCode(code: string, householdId: string): Promise<void>;

  listPushSubscriptions(householdId: string): Promise<PushSubscriptionDoc[]>;
  putPushSubscription(doc: PushSubscriptionDoc): Promise<void>;
  deletePushSubscription(id: string, householdId: string): Promise<void>;
}
