/**
 * Telegram webhook logic: account linking by one-time code, slash commands and inline
 * button callbacks. Only linked chats may act, and the linked user's *current* role is
 * checked with the same permission table as the HTTP API.
 */
import { can, type Action, type ArmSource } from "@esp32cam/shared";
import type { DeviceDoc, LinkCodeDoc, TelegramLinkDoc } from "../ports/store.js";
import type { Services } from "../services.js";
import type { Principal } from "../auth/principal.js";
import { toPrincipal } from "../auth/principal.js";
import { buildCommand, isOffline, type UserCommand } from "./devices.js";
import { acknowledgeEvent } from "./alerts.js";
import { newId, nowSec, shortCode } from "../util.js";

const LINK_CODE_TTL_SEC = 10 * 60;
const SOURCE: ArmSource = "telegram";

/** Minimal slice of Telegram's Update type that we read. */
export interface TelegramUpdate {
  message?: { message_id: number; text?: string; chat: { id: number; type: string; title?: string; first_name?: string; username?: string } };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } }; from: { first_name?: string; username?: string } };
}

export interface TelegramReply { chatId: string; text: string; answerCallback?: { id: string; text: string } }

/** App side: mint a code the user will send to the bot as `/link CODE`. */
export async function createLinkCode(svc: Services, p: Principal): Promise<LinkCodeDoc> {
  const doc: LinkCodeDoc = { type: "linkCode", id: shortCode(6), householdId: p.householdId, code: "", userId: p.userId, expiresAt: nowSec() + LINK_CODE_TTL_SEC };
  doc.code = doc.id;
  await svc.store.putLinkCode(doc);
  return doc;
}

/** Processes one update and returns the replies to send. Pure apart from store/link access, so it is unit-testable without Telegram. */
export async function handleUpdate(svc: Services, update: TelegramUpdate, now = nowSec()): Promise<TelegramReply[]> {
  if (update.callback_query) return handleCallback(svc, update.callback_query, now);
  const msg = update.message;
  if (!msg?.text) return [];
  const chatId = String(msg.chat.id);
  const [rawCmd = "", ...args] = msg.text.trim().split(/\s+/);
  const cmd = rawCmd.toLowerCase().replace(/@\w+$/, ""); // strip "@botname" suffix used in groups

  if (cmd === "/start" || cmd === "/help") {
    return [{ chatId, text: "Home Security bot.\n/link CODE – link this chat (get the code from the app)\n/status · /arm · /disarm · /snapshot · /unlink" }];
  }
  if (cmd === "/link") {
    return [{ chatId, text: await link(svc, chatId, msg.chat.title ?? msg.chat.first_name ?? msg.chat.username ?? "chat", args[0], now) }];
  }

  const ctx = await linkedPrincipal(svc, chatId);
  if (!ctx) return [{ chatId, text: "This chat is not linked. Open the app → Telegram → Link, then send /link CODE here." }];

  switch (cmd) {
    case "/unlink":
      await svc.store.deleteTelegramLink(chatId, ctx.link.householdId);
      return [{ chatId, text: "Unlinked. This chat will no longer receive alerts." }];
    case "/status":
      return [{ chatId, text: await statusText(svc, ctx.principal.householdId, now) }];
    case "/arm":
    case "/disarm":
    case "/snapshot":
      return [{ chatId, text: await runDeviceCommand(svc, ctx.principal, cmd.slice(1) as UserCommand, args[0]) }];
    default:
      return [{ chatId, text: "Unknown command. Try /status, /arm, /disarm, /snapshot." }];
  }
}

async function handleCallback(svc: Services, cb: NonNullable<TelegramUpdate["callback_query"]>, now: number): Promise<TelegramReply[]> {
  const chatId = cb.message ? String(cb.message.chat.id) : "";
  const answer = (text: string): TelegramReply[] => [{ chatId, text: "", answerCallback: { id: cb.id, text } }];
  if (!chatId || !cb.data) return answer("Ignored");

  const ctx = await linkedPrincipal(svc, chatId);
  if (!ctx) return answer("This chat is not linked");
  const who = cb.from.username ? `@${cb.from.username}` : (cb.from.first_name ?? ctx.principal.email);

  const [action = "", deviceId = "", eventId = ""] = cb.data.split("|");
  const device = await svc.store.getDevice(deviceId);
  if (!device || device.householdId !== ctx.principal.householdId) return answer("Unknown device");

  switch (action) {
    case "ack": {
      if (!can(ctx.principal.role, "event.ack")) return answer("Your role may not acknowledge");
      const event = await svc.store.getEvent(deviceId, eventId);
      if (!event) return answer("Event not found");
      await acknowledgeEvent(svc, event, who, now);
      return answer("Acknowledged");
    }
    case "disarm":
      if (!can(ctx.principal.role, "device.disarm")) return answer("Your role may not disarm");
      await svc.link.sendCommand(deviceId, buildCommand("disarm", SOURCE, newId()));
      return answer("Disarm sent");
    case "snapshot":
      if (!can(ctx.principal.role, "device.snapshot")) return answer("Your role may not request snapshots");
      await svc.link.sendCommand(deviceId, buildCommand("snapshot", SOURCE, newId()));
      return answer("Snapshot requested; it will arrive here shortly");
    default:
      return answer("Unknown action");
  }
}

async function link(svc: Services, chatId: string, title: string, code: string | undefined, now: number): Promise<string> {
  if (!code) return "Usage: /link CODE";
  const doc = await svc.store.getLinkCode(code.toUpperCase());
  if (!doc || doc.expiresAt < now) return "That code is invalid or expired. Generate a new one in the app.";
  const user = await svc.store.getUser(doc.userId);
  if (!user || !can(user.role, "telegram.link")) return "The user who created this code may not link chats.";
  const linkDoc: TelegramLinkDoc = { type: "telegramLink", id: chatId, householdId: doc.householdId, chatId, userId: user.id, title, linkedAt: now };
  await svc.store.putTelegramLink(linkDoc);
  await svc.store.deleteLinkCode(doc.id, doc.householdId);
  return `Linked to ${user.email}'s household as ${user.role}. You will receive alerts here.`;
}

async function linkedPrincipal(svc: Services, chatId: string): Promise<{ link: TelegramLinkDoc; principal: Principal } | null> {
  const linkDoc = await svc.store.getTelegramLink(chatId);
  if (!linkDoc) return null;
  const user = await svc.store.getUser(linkDoc.userId);
  if (!user || user.householdId !== linkDoc.householdId) {
    // The linking user left the household: the link dies with them.
    await svc.store.deleteTelegramLink(chatId, linkDoc.householdId);
    return null;
  }
  return { link: linkDoc, principal: toPrincipal(user) };
}

const ACTION_FOR: Record<UserCommand, Action> = { arm: "device.arm", disarm: "device.disarm", snapshot: "device.snapshot", ping: "device.ping" };

async function runDeviceCommand(svc: Services, p: Principal, cmd: UserCommand, deviceArg: string | undefined): Promise<string> {
  if (!can(p.role, ACTION_FOR[cmd])) return `Your role (${p.role}) may not ${cmd}.`;
  const devices = await svc.store.listDevices(p.householdId);
  const device = pickDevice(devices, deviceArg);
  if (!device) return devices.length === 0 ? "No device is registered yet." : `Which device? ${devices.map((d) => d.deviceId).join(", ")}`;
  await svc.link.sendCommand(device.deviceId, buildCommand(cmd, SOURCE, newId()));
  return `${cmd} sent to ${device.name}.`;
}

function pickDevice(devices: DeviceDoc[], arg: string | undefined): DeviceDoc | null {
  if (arg) return devices.find((d) => d.deviceId === arg || d.name.toLowerCase() === arg.toLowerCase()) ?? null;
  return devices.length === 1 ? devices[0]! : null;
}

async function statusText(svc: Services, householdId: string, now: number): Promise<string> {
  const devices = await svc.store.listDevices(householdId);
  if (devices.length === 0) return "No device registered.";
  return devices
    .map((d) => {
      const state = isOffline(d, now) ? "OFFLINE" : d.state;
      const src = d.armSource ? ` (${d.armSource})` : "";
      const last = d.lastEvent ? `\n  last: ${d.lastEvent.type}${d.lastEvent.zone ? ` in ${d.lastEvent.zone}` : ""} at ${new Date(d.lastEvent.ts * 1000).toISOString().slice(11, 19)} UTC` : "";
      return `${d.name}: ${state}${src}${last}`;
    })
    .join("\n");
}
