/**
 * The HTTP API as one route table. functions/http.ts registers it with the Functions host,
 * dev-server.ts serves it over Node http, and tests call handlers directly.
 */
import { TIMING, type AuthResponse, type EventView, type InviteView, type MemberView, type TelegramLinkView } from "@esp32cam/shared";
import type { Route, Req, Res } from "./http/types.js";
import { HttpError, json, noContent } from "./http/respond.js";
import { requireEnum, requireObject, requireString, optionalString } from "./http/validate.js";
import type { Services } from "./services.js";
import { authorize, requireHouseholdDevice, requirePrincipal, type Principal } from "./auth/principal.js";
import { buildCommand, claimDevice, getOrCreateConfig, renameDevice, toDeviceView, updateConfig, type UserCommand } from "./domain/devices.js";
import { acknowledgeEvent } from "./domain/alerts.js";
import { authenticateDevice, grantUpload, readUrlFor } from "./domain/photos.js";
import { changeRole, createInvite, login, register, removeMember, toUserView } from "./domain/accounts.js";
import { createLinkCode, handleUpdate, type TelegramUpdate } from "./domain/telegram-commands.js";
import { ingestMessage } from "./domain/ingest.js";
import type { EventDoc } from "./ports/store.js";
import { newId, nowSec } from "./util.js";
import { EVENT_TYPES } from "@esp32cam/shared";

const toEventView = (e: EventDoc): EventView => ({
  id: e.id, deviceId: e.deviceId, type: e.type, zone: e.zone, score: e.score, photoCount: e.photoCount, photos: e.photos, ts: e.ts,
  acknowledged: e.alert.acknowledged, acknowledgedBy: e.alert.acknowledgedBy, acknowledgedAt: e.alert.acknowledgedAt, repeatCount: e.alert.repeatCount,
});

const toInviteView = (i: { code: string; role: InviteView["role"]; createdAt: number; expiresAt: number; usedBy?: string }): InviteView => ({
  code: i.code, role: i.role, createdAt: i.createdAt, expiresAt: i.expiresAt, usedBy: i.usedBy,
});

type AuthedHandler = (req: Req, p: Principal) => Promise<Res>;

export function buildRoutes(svc: Services): Route[] {
  const authed = (h: AuthedHandler) => async (req: Req) => h(req, await requirePrincipal(req, svc));
  const param = (req: Req, name: string): string => {
    const v = req.params[name];
    if (!v) throw new HttpError(400, "missing_param", name);
    return v;
  };

  const routes: Route[] = [
    // ---- auth ----
    { name: "auth-register", method: "POST", route: "auth/register", handler: async (req) => {
      const { token, user } = await register(svc, await req.json());
      return json({ token, user: toUserView(user) } satisfies AuthResponse, 201);
    } },
    { name: "auth-login", method: "POST", route: "auth/login", handler: async (req) => {
      const { token, user } = await login(svc, await req.json());
      return json({ token, user: toUserView(user) } satisfies AuthResponse);
    } },
    { name: "me", method: "GET", route: "me", handler: authed(async (_req, p) => json(p)) },

    // ---- devices ----
    { name: "devices-list", method: "GET", route: "devices", handler: authed(async (_req, p) => {
      authorize(p, "device.view");
      const devices = await svc.store.listDevices(p.householdId);
      const now = nowSec();
      const views = await Promise.all(devices.map(async (d) => toDeviceView(d, await svc.store.getConfig(d.deviceId), now)));
      return json(views);
    }) },
    { name: "devices-claim", method: "POST", route: "devices", handler: authed(async (req, p) => {
      authorize(p, "device.register");
      const device = await claimDevice(svc, p.householdId, await req.json());
      return json(toDeviceView(device, await svc.store.getConfig(device.deviceId)), 201);
    }) },
    { name: "device-get", method: "GET", route: "devices/{deviceId}", handler: authed(async (req, p) => {
      authorize(p, "device.view");
      const device = await requireHouseholdDevice(p, param(req, "deviceId"), svc);
      return json(toDeviceView(device, await svc.store.getConfig(device.deviceId)));
    }) },
    { name: "device-rename", method: "PATCH", route: "devices/{deviceId}", handler: authed(async (req, p) => {
      authorize(p, "device.register");
      const device = await requireHouseholdDevice(p, param(req, "deviceId"), svc);
      const updated = await renameDevice(svc, device, await req.json());
      return json(toDeviceView(updated, await svc.store.getConfig(updated.deviceId)));
    }) },
    { name: "device-command", method: "POST", route: "devices/{deviceId}/commands", handler: authed(async (req, p) => {
      const device = await requireHouseholdDevice(p, param(req, "deviceId"), svc);
      const cmd = requireEnum(requireObject(await req.json()), "cmd", ["arm", "disarm", "snapshot", "ping"] as const satisfies readonly UserCommand[]);
      authorize(p, cmd === "arm" ? "device.arm" : cmd === "disarm" ? "device.disarm" : cmd === "snapshot" ? "device.snapshot" : "device.ping");
      const command = buildCommand(cmd, "app", newId());
      await svc.link.sendCommand(device.deviceId, command);
      return json({ sent: true, requestId: command.requestId, ts: command.ts }, 202);
    }) },
    { name: "config-get", method: "GET", route: "devices/{deviceId}/config", handler: authed(async (req, p) => {
      authorize(p, "device.view");
      const device = await requireHouseholdDevice(p, param(req, "deviceId"), svc);
      const doc = await getOrCreateConfig(svc, device.deviceId);
      return json({ config: doc.config, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy, appliedVersion: device.appliedConfigVersion });
    }) },
    { name: "config-put", method: "PUT", route: "devices/{deviceId}/config", handler: authed(async (req, p) => {
      authorize(p, "device.config");
      const device = await requireHouseholdDevice(p, param(req, "deviceId"), svc);
      const doc = await updateConfig(svc, device.deviceId, await req.json(), p.email);
      return json({ config: doc.config, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy, appliedVersion: device.appliedConfigVersion });
    }) },
    { name: "events-list", method: "GET", route: "devices/{deviceId}/events", handler: authed(async (req, p) => {
      authorize(p, "device.view");
      const device = await requireHouseholdDevice(p, param(req, "deviceId"), svc);
      const typeRaw = req.query.get("type");
      const type = typeRaw && (EVENT_TYPES as readonly string[]).includes(typeRaw) ? (typeRaw as EventDoc["type"]) : undefined;
      const before = req.query.get("before") ? Number(req.query.get("before")) : undefined;
      const limit = Math.min(Math.max(Number(req.query.get("limit") ?? 50), 1), 200);
      const events = await svc.store.listEvents(device.deviceId, { type, before: Number.isFinite(before) ? before : undefined, limit });
      return json(events.map(toEventView));
    }) },
    { name: "event-ack", method: "POST", route: "devices/{deviceId}/events/{eventId}/ack", handler: authed(async (req, p) => {
      authorize(p, "event.ack");
      const device = await requireHouseholdDevice(p, param(req, "deviceId"), svc);
      const event = await svc.store.getEvent(device.deviceId, param(req, "eventId"));
      if (!event) throw new HttpError(404, "event_not_found");
      return json(toEventView(await acknowledgeEvent(svc, event, p.email)));
    }) },
    { name: "snapshot-latest", method: "GET", route: "devices/{deviceId}/snapshot", handler: authed(async (req, p) => {
      authorize(p, "device.view");
      const device = await requireHouseholdDevice(p, param(req, "deviceId"), svc);
      if (!device.lastSnapshotBlob) return json({ blob: null });
      const signed = await svc.blobs.readUrl(device.lastSnapshotBlob, TIMING.READ_SAS_MINUTES);
      return json({ blob: device.lastSnapshotBlob, url: signed.url, expiresAt: signed.expiresAt, ts: device.lastSnapshotAt });
    }) },

    // ---- photos ----
    { name: "upload-url", method: "GET", route: "upload-url", handler: async (req) => {
      const grant = await grantUpload(svc, req.query.get("deviceId") ?? "", req.query.get("seq"), req.header("x-device-key"));
      return json(grant);
    } },
    { name: "photo-url", method: "GET", route: "photos/url", handler: authed(async (req, p) => {
      authorize(p, "device.view");
      return json(await readUrlFor(svc, p, req.query.get("blob") ?? ""));
    }) },

    // ---- household / family ----
    { name: "household-get", method: "GET", route: "household", handler: authed(async (_req, p) => {
      const [household, members, invites, links] = await Promise.all([
        svc.store.getHousehold(p.householdId), svc.store.listMembers(p.householdId), svc.store.listInvites(p.householdId), svc.store.listTelegramLinks(p.householdId),
      ]);
      const memberViews: MemberView[] = members.map((m) => ({ userId: m.id, email: m.email, role: m.role, joinedAt: m.createdAt }));
      const linkViews: TelegramLinkView[] = links.map((l) => ({ chatId: l.chatId, title: l.title, linkedAt: l.linkedAt }));
      const now = nowSec();
      return json({
        household: household ? { id: household.id, name: household.name } : { id: p.householdId, name: "Home" },
        members: memberViews,
        invites: p.role === "owner" ? invites.filter((i) => !i.usedBy && i.expiresAt > now).map(toInviteView) : [],
        telegramLinks: linkViews,
      });
    }) },
    { name: "invite-create", method: "POST", route: "household/invites", handler: authed(async (req, p) => {
      authorize(p, "member.invite");
      return json(toInviteView(await createInvite(svc, p, await req.json())), 201);
    }) },
    { name: "member-role", method: "PATCH", route: "household/members/{userId}", handler: authed(async (req, p) => {
      authorize(p, "member.manage");
      const u = await changeRole(svc, p, param(req, "userId"), await req.json());
      return json({ userId: u.id, email: u.email, role: u.role, joinedAt: u.createdAt } satisfies MemberView);
    }) },
    { name: "member-remove", method: "DELETE", route: "household/members/{userId}", handler: authed(async (req, p) => {
      authorize(p, "member.manage");
      await removeMember(svc, p, param(req, "userId"));
      return noContent();
    }) },

    // ---- telegram ----
    { name: "telegram-link-code", method: "POST", route: "telegram/link-code", handler: authed(async (_req, p) => {
      authorize(p, "telegram.link");
      const doc = await createLinkCode(svc, p);
      return json({ code: doc.code, expiresAt: doc.expiresAt }, 201);
    }) },
    { name: "telegram-unlink", method: "DELETE", route: "telegram/links/{chatId}", handler: authed(async (req, p) => {
      authorize(p, "telegram.link");
      const link = await svc.store.getTelegramLink(param(req, "chatId"));
      if (!link || link.householdId !== p.householdId) throw new HttpError(404, "link_not_found");
      await svc.store.deleteTelegramLink(link.chatId, link.householdId);
      return noContent();
    }) },
    { name: "telegram-webhook", method: "POST", route: "telegram/webhook", handler: async (req) => {
      // Telegram echoes the secret we gave setWebhook; anything else is not Telegram.
      const secret = svc.config.telegram.webhookSecret;
      if (!secret || req.header("x-telegram-bot-api-secret-token") !== secret) throw new HttpError(401, "bad_webhook_secret");
      const update = (await req.json()) as TelegramUpdate;
      const replies = await handleUpdate(svc, update);
      if (svc.telegram) {
        for (const r of replies) {
          if (r.answerCallback) await svc.telegram.answerCallback(r.answerCallback.id, r.answerCallback.text);
          if (r.text) await svc.telegram.sendMessage(r.chatId, r.text);
        }
      }
      return json({ ok: true });
    } },

    // ---- web push ----
    { name: "push-key", method: "GET", route: "push/vapid-public-key", handler: async () => json({ publicKey: svc.config.vapid.publicKey || null }) },
    { name: "push-subscribe", method: "POST", route: "push/subscribe", handler: authed(async (req, p) => {
      const o = requireObject(await req.json());
      const sub = requireObject(o["subscription"], "subscription");
      const endpoint = requireString(sub, "endpoint", { max: 2048, pattern: /^https:\/\// });
      const keys = requireObject(sub["keys"], "subscription.keys");
      const p256dh = requireString(keys, "p256dh", { max: 256 });
      const auth = requireString(keys, "auth", { max: 128 });
      const existing = (await svc.store.listPushSubscriptions(p.householdId)).find((s) => s.subscription.endpoint === endpoint);
      const id = existing?.id ?? newId();
      await svc.store.putPushSubscription({ type: "pushSub", id, householdId: p.householdId, userId: p.userId, subscription: { endpoint, keys: { p256dh, auth } }, createdAt: existing?.createdAt ?? nowSec() });
      return json({ id }, 201);
    }) },
    { name: "push-unsubscribe", method: "DELETE", route: "push/subscribe", handler: authed(async (req, p) => {
      const endpoint = optionalString(requireObject(await req.json()), "endpoint", { max: 2048 });
      for (const s of await svc.store.listPushSubscriptions(p.householdId)) {
        if (s.userId === p.userId && (!endpoint || s.subscription.endpoint === endpoint)) await svc.store.deletePushSubscription(s.id, s.householdId);
      }
      return noContent();
    }) },

    // ---- devices over HTTPS (local and Supabase modes; Azure devices use IoT Hub MQTT instead) ----
    // Authenticated with the device key; the device id in the URL is the identity that ingest trusts.
    { name: "device-telemetry", method: "POST", route: "device/{deviceId}/telemetry", handler: async (req) => {
      const deviceId = param(req, "deviceId");
      await authenticateDevice(svc, deviceId, req.header("x-device-key"));
      const result = await ingestMessage(svc, deviceId, await req.json());
      return json(result, result.accepted ? 202 : 400);
    } },
    { name: "device-commands", method: "GET", route: "device/{deviceId}/commands", handler: async (req) => {
      const deviceId = param(req, "deviceId");
      await authenticateDevice(svc, deviceId, req.header("x-device-key"));
      if (!svc.link.take) throw new HttpError(404, "not_supported", "this deployment delivers commands over IoT Hub");
      // Kept short: hosts such as Render close idle requests, and the ESP32 polls with wait=0.
      const wait = Math.min(Math.max(Number(req.query.get("wait") ?? 0), 0), 15000);
      return json(await svc.link.take(deviceId, Number.isFinite(wait) ? wait : 0));
    } },

    // ---- local mode only: stand-in for Blob Storage ----
    { name: "local-blob-put", method: "PUT", route: "local/blob/{*name}", localOnly: true, handler: async (req) => localBlob(req, "w") },
    { name: "local-blob-get", method: "GET", route: "local/blob/{*name}", localOnly: true, handler: async (req) => localBlob(req, "r") },
  ];

  async function localBlob(req: Req, perm: "r" | "w"): Promise<Res> {
    if (!svc.local) throw new HttpError(404, "not_local_mode");
    const name = param(req, "name");
    const ok = svc.local.blobs.verify(name, perm, Number(req.query.get("exp")), req.query.get("sig") ?? "") && req.query.get("perm") === perm;
    if (!ok) throw new HttpError(403, "bad_signature", "token missing, expired, wrong permission or wrong blob");
    if (perm === "w") {
      const bytes = await req.bytes();
      if (bytes.length === 0 || bytes.length > 2_000_000) throw new HttpError(400, "bad_size");
      await svc.local.blobs.put(name, bytes);
      return { status: 201 };
    }
    const bytes = await svc.local.blobs.get(name);
    if (!bytes) throw new HttpError(404, "blob_not_found");
    return { status: 200, headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=300" }, body: bytes };
  }

  return routes;
}
