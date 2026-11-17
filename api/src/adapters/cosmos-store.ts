/**
 * Cosmos DB Store. Containers and partition keys are created by docs/setup-azure.md
 * (or by `ensureContainers()` on first use). Point reads use the partition key; the
 * few lookups that cannot (user by email, Telegram chat by id) are cross-partition
 * queries, acceptable at household scale and called out in docs/architecture.md.
 */
import { CosmosClient, type Container, type SqlQuerySpec } from "@azure/cosmos";
import type {
  ConfigDoc, DeviceDoc, EventDoc, EventQuery, HouseholdDoc, InviteDoc, LinkCodeDoc,
  PushSubscriptionDoc, Store, TelegramLinkDoc, UserDoc,
} from "../ports/store.js";

const CONTAINERS = {
  devices: "/deviceId",
  events: "/deviceId",
  config: "/deviceId",
  users: "/householdId",
} as const;

export class CosmosStore implements Store {
  private readonly client: CosmosClient;
  private readonly dbName: string;

  constructor(connectionString: string, database: string) {
    this.client = new CosmosClient(connectionString);
    this.dbName = database;
  }

  /** Idempotent: creates the database and the four containers if they are missing. */
  async ensureContainers(): Promise<void> {
    const { database } = await this.client.databases.createIfNotExists({ id: this.dbName });
    for (const [id, pk] of Object.entries(CONTAINERS)) {
      await database.containers.createIfNotExists({ id, partitionKey: { paths: [pk] } });
    }
  }

  private c(name: keyof typeof CONTAINERS): Container {
    return this.client.database(this.dbName).container(name);
  }

  private async read<T>(name: keyof typeof CONTAINERS, id: string, pk: string): Promise<T | null> {
    const { resource, statusCode } = await this.c(name).item(id, pk).read();
    return statusCode === 404 || !resource ? null : (resource as unknown as T);
  }

  private async query<T>(name: keyof typeof CONTAINERS, spec: SqlQuerySpec, partitionKey?: string): Promise<T[]> {
    const { resources } = await this.c(name).items.query<T>(spec, { partitionKey }).fetchAll();
    return resources;
  }

  private async upsert(name: keyof typeof CONTAINERS, doc: object): Promise<void> {
    await this.c(name).items.upsert(doc);
  }

  private async remove(name: keyof typeof CONTAINERS, id: string, pk: string): Promise<void> {
    try {
      await this.c(name).item(id, pk).delete();
    } catch (err) {
      if ((err as { code?: number }).code !== 404) throw err;
    }
  }

  getDevice(deviceId: string) { return this.read<DeviceDoc>("devices", deviceId, deviceId); }
  listDevices(householdId: string) {
    return this.query<DeviceDoc>("devices", { query: "SELECT * FROM c WHERE c.householdId = @h", parameters: [{ name: "@h", value: householdId }] });
  }
  listAllDevices() { return this.query<DeviceDoc>("devices", { query: "SELECT * FROM c" }); }
  putDevice(doc: DeviceDoc) { return this.upsert("devices", doc); }

  getConfig(deviceId: string) { return this.read<ConfigDoc>("config", deviceId, deviceId); }
  putConfig(doc: ConfigDoc) { return this.upsert("config", doc); }

  getEvent(deviceId: string, id: string) { return this.read<EventDoc>("events", id, deviceId); }
  putEvent(doc: EventDoc) { return this.upsert("events", doc); }
  listEvents(deviceId: string, q: EventQuery) {
    const clauses = ["c.deviceId = @d"];
    const parameters: SqlQuerySpec["parameters"] = [{ name: "@d", value: deviceId }, { name: "@limit", value: q.limit }];
    if (q.type) { clauses.push("c.type = @t"); parameters.push({ name: "@t", value: q.type }); }
    if (q.before !== undefined) { clauses.push("c.ts < @b"); parameters.push({ name: "@b", value: q.before }); }
    return this.query<EventDoc>("events", { query: `SELECT TOP @limit * FROM c WHERE ${clauses.join(" AND ")} ORDER BY c.ts DESC`, parameters }, deviceId);
  }
  listUnacknowledgedEvents() {
    return this.query<EventDoc>("events", { query: "SELECT * FROM c WHERE c.alert.acknowledged = false ORDER BY c.ts DESC" });
  }

  getUser(id: string) {
    return this.one<UserDoc>({ query: "SELECT * FROM c WHERE c.type = 'user' AND c.id = @id", parameters: [{ name: "@id", value: id }] });
  }
  getUserByEmail(email: string) {
    return this.one<UserDoc>({ query: "SELECT * FROM c WHERE c.type = 'user' AND c.email = @e", parameters: [{ name: "@e", value: email }] });
  }
  putUser(doc: UserDoc) { return this.upsert("users", doc); }
  deleteUser(id: string, householdId: string) { return this.remove("users", id, householdId); }
  listMembers(householdId: string) {
    return this.query<UserDoc>("users", { query: "SELECT * FROM c WHERE c.type = 'user'" }, householdId);
  }

  getHousehold(id: string) { return this.read<HouseholdDoc>("users", id, id); }
  putHousehold(doc: HouseholdDoc) { return this.upsert("users", doc); }

  getInvite(code: string) {
    return this.one<InviteDoc>({ query: "SELECT * FROM c WHERE c.type = 'invite' AND c.id = @id", parameters: [{ name: "@id", value: code }] });
  }
  putInvite(doc: InviteDoc) { return this.upsert("users", doc); }
  listInvites(householdId: string) {
    return this.query<InviteDoc>("users", { query: "SELECT * FROM c WHERE c.type = 'invite'" }, householdId);
  }

  getTelegramLink(chatId: string) {
    return this.one<TelegramLinkDoc>({ query: "SELECT * FROM c WHERE c.type = 'telegramLink' AND c.id = @id", parameters: [{ name: "@id", value: chatId }] });
  }
  listTelegramLinks(householdId: string) {
    return this.query<TelegramLinkDoc>("users", { query: "SELECT * FROM c WHERE c.type = 'telegramLink'" }, householdId);
  }
  putTelegramLink(doc: TelegramLinkDoc) { return this.upsert("users", doc); }
  deleteTelegramLink(chatId: string, householdId: string) { return this.remove("users", chatId, householdId); }

  getLinkCode(code: string) {
    return this.one<LinkCodeDoc>({ query: "SELECT * FROM c WHERE c.type = 'linkCode' AND c.id = @id", parameters: [{ name: "@id", value: code }] });
  }
  putLinkCode(doc: LinkCodeDoc) { return this.upsert("users", doc); }
  deleteLinkCode(code: string, householdId: string) { return this.remove("users", code, householdId); }

  listPushSubscriptions(householdId: string) {
    return this.query<PushSubscriptionDoc>("users", { query: "SELECT * FROM c WHERE c.type = 'pushSub'" }, householdId);
  }
  putPushSubscription(doc: PushSubscriptionDoc) { return this.upsert("users", doc); }
  deletePushSubscription(id: string, householdId: string) { return this.remove("users", id, householdId); }

  private async one<T>(spec: SqlQuerySpec): Promise<T | null> {
    const rows = await this.query<T>("users", spec);
    return rows[0] ?? null;
  }
}
