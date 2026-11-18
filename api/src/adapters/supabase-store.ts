/**
 * Store on Supabase Postgres (see supabase/schema.sql). Each table keeps the whole document in
 * a `doc` JSONB column plus the few columns we filter on, so this adapter is a near line-by-line
 * twin of cosmos-store.ts. Uses the service-role key, which bypasses RLS: server-side only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ConfigDoc, DeviceDoc, EventDoc, EventQuery, HouseholdDoc, InviteDoc, LinkCodeDoc,
  PushSubscriptionDoc, Store, TelegramLinkDoc, UserDoc,
} from "../ports/store.js";

type AccountDoc = UserDoc | HouseholdDoc | InviteDoc | TelegramLinkDoc | LinkCodeDoc | PushSubscriptionDoc;

type Row = { doc: unknown };
type Result = { data: unknown; error: { message: string } | null };

/** Throws on a Supabase error so failures surface as 500s with a log line, never as empty results. */
function check(res: Result, what: string): void {
  if (res.error) throw new Error(`supabase ${what}: ${res.error.message}`);
}
function one(res: Result, what: string): Row | null {
  check(res, what);
  return (res.data as Row | null) ?? null;
}
function many(res: Result, what: string): Row[] {
  check(res, what);
  return (res.data as Row[] | null) ?? [];
}

export class SupabaseStore implements Store {
  constructor(private readonly db: SupabaseClient) {}

  // ---- devices ----
  async getDevice(deviceId: string) {
    const row = one(await this.db.from("devices").select("doc").eq("device_id", deviceId).maybeSingle(), "getDevice");
    return (row?.doc as DeviceDoc | undefined) ?? null;
  }
  async listDevices(householdId: string) {
    const rows = many(await this.db.from("devices").select("doc").eq("household_id", householdId), "listDevices");
    return rows.map((r) => r.doc as DeviceDoc);
  }
  async listAllDevices() {
    const rows = many(await this.db.from("devices").select("doc"), "listAllDevices");
    return rows.map((r) => r.doc as DeviceDoc);
  }
  async putDevice(doc: DeviceDoc) {
    check(await this.db.from("devices").upsert({ device_id: doc.deviceId, household_id: doc.householdId, doc, updated_at: new Date().toISOString() }), "putDevice");
  }

  // ---- config ----
  async getConfig(deviceId: string) {
    const row = one(await this.db.from("device_config").select("doc").eq("device_id", deviceId).maybeSingle(), "getConfig");
    return (row?.doc as ConfigDoc | undefined) ?? null;
  }
  async putConfig(doc: ConfigDoc) {
    check(await this.db.from("device_config").upsert({ device_id: doc.deviceId, doc, updated_at: new Date().toISOString() }), "putConfig");
  }

  // ---- events ----
  async getEvent(deviceId: string, id: string) {
    const row = one(await this.db.from("events").select("doc").eq("device_id", deviceId).eq("id", id).maybeSingle(), "getEvent");
    return (row?.doc as EventDoc | undefined) ?? null;
  }
  async putEvent(doc: EventDoc) {
    check(await this.db.from("events").upsert({ device_id: doc.deviceId, id: doc.id, ts: doc.ts, type: doc.type, acknowledged: doc.alert.acknowledged, doc }), "putEvent");
  }
  async listEvents(deviceId: string, q: EventQuery) {
    let query = this.db.from("events").select("doc").eq("device_id", deviceId);
    if (q.type) query = query.eq("type", q.type);
    if (q.before !== undefined) query = query.lt("ts", q.before);
    const rows = many(await query.order("ts", { ascending: false }).limit(q.limit), "listEvents");
    return rows.map((r) => r.doc as EventDoc);
  }
  async listUnacknowledgedEvents() {
    const rows = many(await this.db.from("events").select("doc").eq("acknowledged", false).order("ts", { ascending: false }).limit(500), "listUnacknowledgedEvents");
    return rows.map((r) => r.doc as EventDoc);
  }

  // ---- accounts (users container) ----
  private async getAccount<T extends AccountDoc>(type: T["type"], id: string): Promise<T | null> {
    const row = one(await this.db.from("accounts").select("doc").eq("type", type).eq("id", id).maybeSingle(), `get ${type}`);
    return (row?.doc as T | undefined) ?? null;
  }
  private async listAccounts<T extends AccountDoc>(type: T["type"], householdId: string): Promise<T[]> {
    const rows = many(await this.db.from("accounts").select("doc").eq("type", type).eq("household_id", householdId), `list ${type}`);
    return rows.map((r) => r.doc as T);
  }
  private async putAccount(doc: AccountDoc): Promise<void> {
    const email = doc.type === "user" ? doc.email : null;
    check(await this.db.from("accounts").upsert({ type: doc.type, id: doc.id, household_id: doc.householdId, email, doc }), `put ${doc.type}`);
  }
  private async deleteAccount(type: AccountDoc["type"], id: string): Promise<void> {
    check(await this.db.from("accounts").delete().eq("type", type).eq("id", id), `delete ${type}`);
  }

  getUser(id: string) { return this.getAccount<UserDoc>("user", id); }
  async getUserByEmail(email: string) {
    const row = one(await this.db.from("accounts").select("doc").eq("type", "user").eq("email", email).maybeSingle(), "getUserByEmail");
    return (row?.doc as UserDoc | undefined) ?? null;
  }
  putUser(doc: UserDoc) { return this.putAccount(doc); }
  deleteUser(id: string) { return this.deleteAccount("user", id); }
  listMembers(householdId: string) { return this.listAccounts<UserDoc>("user", householdId); }

  getHousehold(id: string) { return this.getAccount<HouseholdDoc>("household", id); }
  putHousehold(doc: HouseholdDoc) { return this.putAccount(doc); }

  getInvite(code: string) { return this.getAccount<InviteDoc>("invite", code); }
  putInvite(doc: InviteDoc) { return this.putAccount(doc); }
  listInvites(householdId: string) { return this.listAccounts<InviteDoc>("invite", householdId); }

  getTelegramLink(chatId: string) { return this.getAccount<TelegramLinkDoc>("telegramLink", chatId); }
  listTelegramLinks(householdId: string) { return this.listAccounts<TelegramLinkDoc>("telegramLink", householdId); }
  putTelegramLink(doc: TelegramLinkDoc) { return this.putAccount(doc); }
  deleteTelegramLink(chatId: string) { return this.deleteAccount("telegramLink", chatId); }

  getLinkCode(code: string) { return this.getAccount<LinkCodeDoc>("linkCode", code); }
  putLinkCode(doc: LinkCodeDoc) { return this.putAccount(doc); }
  deleteLinkCode(code: string) { return this.deleteAccount("linkCode", code); }

  listPushSubscriptions(householdId: string) { return this.listAccounts<PushSubscriptionDoc>("pushSub", householdId); }
  putPushSubscription(doc: PushSubscriptionDoc) { return this.putAccount(doc); }
  deletePushSubscription(id: string) { return this.deleteAccount("pushSub", id); }
}
