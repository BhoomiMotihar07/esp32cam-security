#!/usr/bin/env node
/**
 * Telegram webhook helper.
 *   node scripts/set-telegram-webhook.mjs https://<func>.azurewebsites.net/api/telegram/webhook
 *   node scripts/set-telegram-webhook.mjs --poll http://localhost:7071/api/telegram/webhook
 * Needs TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in the environment.
 * --poll: for local development without a public URL; long-polls getUpdates and forwards each
 * update to the local webhook with the secret header, exactly as Telegram would.
 */
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const args = process.argv.slice(2);
const poll = args.includes("--poll");
const url = args.find((a) => !a.startsWith("--"));
if (!token || !secret || !url) {
  console.error("usage: TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/set-telegram-webhook.mjs [--poll] <webhook url>");
  process.exit(1);
}
const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then((r) => r.json());

if (!poll) {
  console.log(await api("setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"] }));
  console.log(await api("getWebhookInfo"));
  process.exit(0);
}

// Polling mode: Telegram refuses getUpdates while a webhook is set, so remove it first.
console.log("deleteWebhook:", (await api("deleteWebhook")).ok);
let offset = 0;
console.log(`forwarding updates to ${url} (Ctrl-C to stop)`);
for (;;) {
  const res = await api("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "callback_query"] });
  for (const update of res.result ?? []) {
    offset = update.update_id + 1;
    const fwd = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
      body: JSON.stringify(update),
    });
    console.log(`update ${update.update_id} -> ${fwd.status}`);
  }
}
