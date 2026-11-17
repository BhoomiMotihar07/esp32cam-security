# Telegram setup

Alerts (first photo + inline buttons), reminders every 30 s, and the commands `/status /arm /disarm
/snapshot` are sent by the **backend**. The firmware only talks to Telegram directly as a fallback
when no IoT Hub is configured or the hub is unreachable (see `firmware/src/net/NetworkTask.cpp`).

## 1. Create the bot

1. In Telegram open **@BotFather** → `/newbot` → choose a name and a username ending in `bot`.
2. Copy the token (`123456:ABC-…`) → `TELEGRAM_BOT_TOKEN` in the Function App settings
   (or `api/local.settings.json` / exported env for the dev server).
3. Optional: `/setcommands` in BotFather and paste

   ```
   status - Device states and last event
   arm - Arm the system
   disarm - Disarm the system
   snapshot - Take a photo now
   link - Link this chat with a code from the app
   unlink - Stop receiving alerts here
   ```

## 2. Point the webhook at the API

Telegram must reach the API over HTTPS, so this is for the deployed Function App (for local
development use the Telegram *polling* alternative below, or a tunnel such as `ngrok http 7071`).

```sh
TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
node scripts/set-telegram-webhook.mjs https://homesec-func-<you>.azurewebsites.net/api/telegram/webhook
```

The script calls `setWebhook` with `secret_token`; the API rejects any request whose
`X-Telegram-Bot-Api-Secret-Token` header does not match. It then prints `getWebhookInfo` so you can
see `pending_update_count` and the last error if any.

Local alternative without a public URL: run the dev server, then in another terminal poll updates
and forward them yourself:

```sh
# every update Telegram has queued is POSTed to the local webhook with the secret header
node scripts/set-telegram-webhook.mjs --poll http://localhost:7071/api/telegram/webhook
```

## 3. Link a chat

1. App → **Family → Telegram → Get a link code** (owner or member role).
2. Send `/link ABC123` to the bot (private chat, or in a group where the bot is a member).
3. The bot replies "Linked to … as owner/member". Codes expire after 10 minutes and are single-use.

What the linked chat can do depends on the linking user's **current** role: a viewer's chat only
gets `/status`; if the user is removed from the household, the link is dropped on the next message.
Anyone who can type in a linked group chat acts with that role, so link private chats unless the
group is the family.

## 4. What arrives

- New event: photo (or text if no photo uploaded) with `[✅ Acknowledge] [🔓 Disarm] [📸 Snapshot]`.
- Every 30 s until acknowledged (max `ALERT_MAX_REPEATS`): "🔁 Reminder n" with the same buttons.
- On acknowledge (from app or button): buttons removed, "✅ … acknowledged by …".
- Device offline / back online.
- Snapshot requested from Telegram arrives in the app's Status tab (Telegram gets the next alert
  photo; sending the snapshot back to the chat is a small follow-up, see README gaps).

## Firmware direct fallback

`include/secrets.h`: set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (your numeric chat id, e.g.
from `@userinfobot`). With `AZURE_IOT_HUB_HOST` empty the device sends every event's first photo
straight to that chat, so the camera is useful before the Azure side exists. There are no buttons
in that mode and nothing is stored.
