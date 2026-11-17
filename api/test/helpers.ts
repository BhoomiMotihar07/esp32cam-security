/** Test services: memory store, local blobs in a temp dir, recording link + Telegram fakes. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeviceCommand } from "@esp32cam/shared";
import type { AppConfig } from "../src/config.js";
import { createServices, type Services } from "../src/services.js";
import { MemoryStore } from "../src/adapters/memory-store.js";
import { LocalBlobs } from "../src/adapters/local-blobs.js";
import type { DeviceLink } from "../src/ports/device-link.js";
import type { TelegramClient, InlineKeyboard } from "../src/domain/telegram-client.js";
import type { Req } from "../src/http/types.js";
import { buildRoutes } from "../src/routes.js";
import { compileRoute, matchRoute } from "../src/http/match.js";

export const testConfig: AppConfig = {
  mode: "local",
  jwtSecret: "test-secret-test-secret",
  setupCode: "setup-code",
  appOrigin: "http://localhost:5173",
  publicApiBase: "http://localhost:7071/api",
  localDataDir: mkdtempSync(join(tmpdir(), "esp32cam-test-")),
  localBlobSecret: "blob-secret",
  cosmos: { connectionString: "", database: "" },
  storage: { connectionString: "", container: "" },
  iotHub: { serviceConnectionString: "" },
  telegram: { botToken: "", webhookSecret: "hook-secret" },
  vapid: { publicKey: "", privateKey: "", subject: "" },
  alertMaxRepeats: 3,
  devPort: 0,
};

export class RecordingLink implements DeviceLink {
  sent: { deviceId: string; command: DeviceCommand }[] = [];
  async sendCommand(deviceId: string, command: DeviceCommand) { this.sent.push({ deviceId, command }); }
  last(): DeviceCommand | undefined { return this.sent.at(-1)?.command; }
}

export class FakeTelegram {
  messages: { chatId: string; text: string; keyboard?: InlineKeyboard; photo?: boolean }[] = [];
  cleared: number[] = [];
  private nextId = 1;
  async sendMessage(chatId: string, text: string, keyboard?: InlineKeyboard) { this.messages.push({ chatId, text, keyboard }); return { message_id: this.nextId++ }; }
  async sendPhoto(chatId: string, _jpeg: Uint8Array, caption: string, keyboard?: InlineKeyboard) { this.messages.push({ chatId, text: caption, keyboard, photo: true }); return { message_id: this.nextId++ }; }
  async clearKeyboard(_chatId: string, messageId: number) { this.cleared.push(messageId); }
  async answerCallback() { return null; }
  async setWebhook() { return null; }
  async getMe() { return { username: "fake_bot" }; }
}

export interface TestWorld { svc: Services; link: RecordingLink; telegram: FakeTelegram; blobs: LocalBlobs }

export function makeWorld(overrides: Partial<AppConfig> = {}): TestWorld {
  const config = { ...testConfig, ...overrides, localDataDir: mkdtempSync(join(tmpdir(), "esp32cam-test-")) };
  const link = new RecordingLink();
  const telegram = new FakeTelegram();
  const blobs = new LocalBlobs(join(config.localDataDir, "blobs"), config.localBlobSecret, config.publicApiBase);
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const svc = createServices(config, { store: new MemoryStore(), blobs, link, telegram: telegram as unknown as TelegramClient, log: quiet, local: { blobs, link: link as never } });
  return { svc, link, telegram, blobs };
}

/** Calls a route the way the dev server would, returning status + parsed JSON. */
export async function call(svc: Services, method: string, path: string, opts: { body?: unknown; token?: string; headers?: Record<string, string> } = {}) {
  const [pathname, search = ""] = path.split("?");
  const routes = buildRoutes(svc);
  for (const route of routes) {
    if (route.method !== method) continue;
    const params = matchRoute(compileRoute(route.route), pathname!);
    if (!params) continue;
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
    const req: Req = {
      method, path: pathname!, params, query: new URLSearchParams(search),
      header: (n) => headers[n.toLowerCase()] ?? null,
      json: async () => opts.body as never,
      bytes: async () => (opts.body instanceof Uint8Array ? opts.body : new Uint8Array()),
    };
    try {
      const res = await route.handler(req);
      const text = typeof res.body === "string" ? res.body : "";
      return { status: res.status, json: text ? JSON.parse(text) : null, body: res.body };
    } catch (err) {
      const e = err as { status?: number; message: string; detail?: string };
      return { status: e.status ?? 500, json: { error: e.message, detail: e.detail }, body: undefined };
    }
  }
  throw new Error(`no route for ${method} ${path}`);
}

/** Creates an owner household and returns the token. */
export async function registerOwner(svc: Services, email = "owner@example.com"): Promise<string> {
  const res = await call(svc, "POST", "auth/register", { body: { email, password: "password123", setupCode: "setup-code", householdName: "Flat 4B" } });
  if (res.status !== 201) throw new Error(`register failed ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.token as string;
}

export async function registerWithInvite(svc: Services, ownerToken: string, role: "member" | "viewer", email: string): Promise<string> {
  const invite = await call(svc, "POST", "household/invites", { token: ownerToken, body: { role } });
  const res = await call(svc, "POST", "auth/register", { body: { email, password: "password123", inviteCode: invite.json.code } });
  if (res.status !== 201) throw new Error(`invite register failed ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.token as string;
}

export async function claimDevice(svc: Services, ownerToken: string, deviceId = "cam-01", uploadKey = "dev-upload-key-123") {
  const res = await call(svc, "POST", "devices", { token: ownerToken, body: { deviceId, name: "Hall cam", uploadKey } });
  if (res.status !== 201) throw new Error(`claim failed ${res.status} ${JSON.stringify(res.json)}`);
  return res.json;
}

export const nowSec = () => Math.floor(Date.now() / 1000);

export const heartbeat = (deviceId: string, ts: number, extra: Record<string, unknown> = {}) => ({
  kind: "heartbeat", deviceId, state: "ARMED", armSource: "app", rssi: -60, uptime: 100, resetReason: "POWERON", brightness: 120, ts, ...extra,
});
