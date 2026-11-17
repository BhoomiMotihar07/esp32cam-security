/** Web Push (VAPID). Subscriptions that the push service reports gone (404/410) are removed. */
import webpush from "web-push";
import type { PushSubscriptionDoc, Store } from "../ports/store.js";
import type { Logger } from "../util.js";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export class PushSender {
  constructor(vapid: { publicKey: string; privateKey: string; subject: string }, private readonly log: Logger) {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  }

  async sendToAll(store: Store, subs: PushSubscriptionDoc[], payload: PushPayload): Promise<void> {
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(sub.subscription, JSON.stringify(payload), { TTL: 60 });
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await store.deletePushSubscription(sub.id, sub.householdId);
            this.log.info("removed dead push subscription", { id: sub.id });
          } else {
            this.log.warn("push send failed", { id: sub.id, status });
          }
        }
      }),
    );
  }
}
