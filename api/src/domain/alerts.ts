/**
 * Alert lifecycle: notify on a new event, repeat every ALERT_REPEAT_SEC until acknowledged
 * (capped by ALERT_MAX_REPEATS), acknowledge from app or Telegram, and tell the device.
 */
import { TIMING, type EventType } from "@esp32cam/shared";
import type { DeviceDoc, EventDoc } from "../ports/store.js";
import type { Services } from "../services.js";
import type { InlineKeyboard } from "./telegram-client.js";
import { nowSec } from "../util.js";

const LABEL: Record<EventType, string> = {
  motion: "Motion detected",
  sound: "Loud sound detected",
  tamper_dark: "Camera covered or scene went dark",
  tamper_moved: "Camera moved or turned",
  offline: "Device offline",
};

/** Offline alerts are informational and auto-clear; intrusion alerts repeat until acknowledged. */
export const repeatsUntilAck = (type: EventType): boolean => type !== "offline";

function fmtTime(ts: number): string {
  return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export function alertText(event: EventDoc, device: DeviceDoc, repeat = 0): string {
  const where = event.zone ? ` in <b>${escapeHtml(event.zone)}</b>` : "";
  const head = repeat > 0 ? `🔁 Reminder ${repeat}: ` : "🚨 ";
  return `${head}<b>${LABEL[event.type]}</b>${where}\n📷 ${escapeHtml(device.name)} · ${fmtTime(event.ts)}\nscore ${event.score.toFixed(2)} · ${event.photoCount} photo(s)`;
}

export function alertKeyboard(event: EventDoc): InlineKeyboard {
  return [[
    { text: "✅ Acknowledge", callback_data: `ack|${event.deviceId}|${event.id}` },
    { text: "🔓 Disarm", callback_data: `disarm|${event.deviceId}` },
    { text: "📸 Snapshot", callback_data: `snapshot|${event.deviceId}` },
  ]];
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** First notification: Telegram (with the first photo when there is one) and web push. */
export async function notifyNewEvent(svc: Services, event: EventDoc, device: DeviceDoc, now = nowSec()): Promise<void> {
  if (!device.householdId) return; // unclaimed devices are stored but nobody is notified
  const keyboard = event.type === "offline" ? undefined : alertKeyboard(event);
  const text = alertText(event, device);

  if (svc.telegram) {
    const links = await svc.store.listTelegramLinks(device.householdId);
    const photo = event.photos[0] ? await svc.blobs.get(event.photos[0]) : null;
    for (const link of links) {
      const sent = photo
        ? await svc.telegram.sendPhoto(link.chatId, photo, text, keyboard)
        : await svc.telegram.sendMessage(link.chatId, text, keyboard);
      if (sent) event.alert.telegramMessages.push({ chatId: link.chatId, messageId: sent.message_id });
    }
  }
  if (svc.push) {
    const subs = await svc.store.listPushSubscriptions(device.householdId);
    await svc.push.sendToAll(svc.store, subs, {
      title: LABEL[event.type],
      body: `${device.name}${event.zone ? ` · ${event.zone}` : ""}`,
      url: `/events?device=${device.deviceId}`,
      tag: `event-${event.id}`,
    });
  }
  event.alert.lastSentAt = now;
  await svc.store.putEvent(event);
}

/** Called by the 30 s timer. Returns how many reminders went out (for logs and tests). */
export async function repeatPendingAlerts(svc: Services, now = nowSec()): Promise<number> {
  const pending = await svc.store.listUnacknowledgedEvents();
  let sent = 0;
  for (const event of pending) {
    if (!repeatsUntilAck(event.type)) continue;
    if (event.alert.repeatCount >= svc.config.alertMaxRepeats) continue;
    if (now - event.alert.lastSentAt < TIMING.ALERT_REPEAT_SEC) continue;
    const device = await svc.store.getDevice(event.deviceId);
    if (!device || !device.householdId) continue;

    event.alert.repeatCount += 1;
    event.alert.lastSentAt = now;
    const text = alertText(event, device, event.alert.repeatCount);
    if (svc.telegram) {
      for (const link of await svc.store.listTelegramLinks(device.householdId)) {
        const msg = await svc.telegram.sendMessage(link.chatId, text, alertKeyboard(event));
        if (msg) event.alert.telegramMessages.push({ chatId: link.chatId, messageId: msg.message_id });
      }
    }
    if (svc.push) {
      const subs = await svc.store.listPushSubscriptions(device.householdId);
      await svc.push.sendToAll(svc.store, subs, { title: `Reminder: ${LABEL[event.type]}`, body: device.name, url: `/events?device=${device.deviceId}`, tag: `event-${event.id}` });
    }
    await svc.store.putEvent(event);
    sent++;
  }
  return sent;
}

/** Marks the alert handled, silences the device, and removes the Telegram buttons. */
export async function acknowledgeEvent(svc: Services, event: EventDoc, by: string, now = nowSec()): Promise<EventDoc> {
  if (event.alert.acknowledged) return event;
  event.alert.acknowledged = true;
  event.alert.acknowledgedBy = by;
  event.alert.acknowledgedAt = now;
  await svc.store.putEvent(event);
  if (event.type !== "offline") {
    await svc.link.sendCommand(event.deviceId, { cmd: "ack", ts: now, requestId: `ack-${event.id}` });
  }
  if (svc.telegram) {
    for (const m of event.alert.telegramMessages) await svc.telegram.clearKeyboard(m.chatId, m.messageId);
    const device = await svc.store.getDevice(event.deviceId);
    if (device) {
      for (const link of await svc.store.listTelegramLinks(device.householdId)) {
        await svc.telegram.sendMessage(link.chatId, `✅ ${LABEL[event.type]} on ${escapeHtml(device.name)} acknowledged by ${escapeHtml(by)}`);
      }
    }
  }
  return event;
}
