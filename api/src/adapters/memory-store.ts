/**
 * In-memory Store for local mode and tests. Optionally persists to a JSON file (debounced)
 * so the dev server survives restarts. Queries are plain array filters that mirror the
 * Cosmos SQL in cosmos-store.ts one-to-one.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type {
  ConfigDoc, DeviceDoc, EventDoc, EventQuery, HouseholdDoc, InviteDoc, LinkCodeDoc,
  PushSubscriptionDoc, Store, TelegramLinkDoc, UserDoc,
} from "../ports/store.js";

type UsersContainerDoc = UserDoc | HouseholdDoc | InviteDoc | TelegramLinkDoc | LinkCodeDoc | PushSubscriptionDoc;

interface Snapshot {
  devices: DeviceDoc[];
  config: ConfigDoc[];
  events: EventDoc[];
  users: UsersContainerDoc[];
}

export class MemoryStore implements Store {
  private devices = new Map<string, DeviceDoc>();
  private config = new Map<string, ConfigDoc>();
  private events = new Map<string, EventDoc>(); // key deviceId/id
  private users = new Map<string, UsersContainerDoc>(); // key type/id
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly filePath?: string) {
    if (filePath && existsSync(filePath)) this.load(JSON.parse(readFileSync(filePath, "utf8")) as Snapshot);
  }

  private load(s: Snapshot): void {
    for (const d of s.devices ?? []) this.devices.set(d.id, d);
    for (const c of s.config ?? []) this.config.set(c.id, c);
    for (const e of s.events ?? []) this.events.set(`${e.deviceId}/${e.id}`, e);
    for (const u of s.users ?? []) this.users.set(`${u.type}/${u.id}`, u);
  }

  /** Debounced write so a burst of heartbeats does not hammer the disk. */
  private persist(): void {
    if (!this.filePath) return;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const snapshot: Snapshot = {
        devices: [...this.devices.values()],
        config: [...this.config.values()],
        events: [...this.events.values()],
        users: [...this.users.values()],
      };
      mkdirSync(dirname(this.filePath!), { recursive: true });
      writeFileSync(this.filePath!, JSON.stringify(snapshot));
    }, 250);
    this.saveTimer.unref();
  }

  private usersOf<T extends UsersContainerDoc>(type: T["type"]): T[] {
    return [...this.users.values()].filter((d): d is T => d.type === type);
  }

  async getDevice(deviceId: string) { return this.devices.get(deviceId) ?? null; }
  async listDevices(householdId: string) { return [...this.devices.values()].filter((d) => d.householdId === householdId); }
  async listAllDevices() { return [...this.devices.values()]; }
  async putDevice(doc: DeviceDoc) { this.devices.set(doc.id, structuredClone(doc)); this.persist(); }

  async getConfig(deviceId: string) { return this.config.get(deviceId) ?? null; }
  async putConfig(doc: ConfigDoc) { this.config.set(doc.id, structuredClone(doc)); this.persist(); }

  async getEvent(deviceId: string, id: string) { return this.events.get(`${deviceId}/${id}`) ?? null; }
  async putEvent(doc: EventDoc) { this.events.set(`${doc.deviceId}/${doc.id}`, structuredClone(doc)); this.persist(); }
  async listEvents(deviceId: string, q: EventQuery) {
    return [...this.events.values()]
      .filter((e) => e.deviceId === deviceId && (!q.type || e.type === q.type) && (q.before === undefined || e.ts < q.before))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, q.limit);
  }
  async listUnacknowledgedEvents() {
    return [...this.events.values()].filter((e) => !e.alert.acknowledged).sort((a, b) => b.ts - a.ts);
  }

  async getUser(id: string) { return (this.users.get(`user/${id}`) as UserDoc | undefined) ?? null; }
  async getUserByEmail(email: string) { return this.usersOf<UserDoc>("user").find((u) => u.email === email) ?? null; }
  async putUser(doc: UserDoc) { this.users.set(`user/${doc.id}`, structuredClone(doc)); this.persist(); }
  async deleteUser(id: string) { this.users.delete(`user/${id}`); this.persist(); }
  async listMembers(householdId: string) { return this.usersOf<UserDoc>("user").filter((u) => u.householdId === householdId); }

  async getHousehold(id: string) { return (this.users.get(`household/${id}`) as HouseholdDoc | undefined) ?? null; }
  async putHousehold(doc: HouseholdDoc) { this.users.set(`household/${doc.id}`, structuredClone(doc)); this.persist(); }

  async getInvite(code: string) { return (this.users.get(`invite/${code}`) as InviteDoc | undefined) ?? null; }
  async putInvite(doc: InviteDoc) { this.users.set(`invite/${doc.id}`, structuredClone(doc)); this.persist(); }
  async listInvites(householdId: string) { return this.usersOf<InviteDoc>("invite").filter((i) => i.householdId === householdId); }

  async getTelegramLink(chatId: string) { return (this.users.get(`telegramLink/${chatId}`) as TelegramLinkDoc | undefined) ?? null; }
  async listTelegramLinks(householdId: string) { return this.usersOf<TelegramLinkDoc>("telegramLink").filter((l) => l.householdId === householdId); }
  async putTelegramLink(doc: TelegramLinkDoc) { this.users.set(`telegramLink/${doc.id}`, structuredClone(doc)); this.persist(); }
  async deleteTelegramLink(chatId: string) { this.users.delete(`telegramLink/${chatId}`); this.persist(); }

  async getLinkCode(code: string) { return (this.users.get(`linkCode/${code}`) as LinkCodeDoc | undefined) ?? null; }
  async putLinkCode(doc: LinkCodeDoc) { this.users.set(`linkCode/${doc.id}`, structuredClone(doc)); this.persist(); }
  async deleteLinkCode(code: string) { this.users.delete(`linkCode/${code}`); this.persist(); }

  async listPushSubscriptions(householdId: string) { return this.usersOf<PushSubscriptionDoc>("pushSub").filter((p) => p.householdId === householdId); }
  async putPushSubscription(doc: PushSubscriptionDoc) { this.users.set(`pushSub/${doc.id}`, structuredClone(doc)); this.persist(); }
  async deletePushSubscription(id: string) { this.users.delete(`pushSub/${id}`); this.persist(); }
}
