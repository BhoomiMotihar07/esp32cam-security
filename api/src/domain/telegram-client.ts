/** Minimal Telegram Bot API client over fetch. Only the five calls this project needs. */
import type { Logger } from "../util.js";

export interface InlineButton { text: string; callback_data: string }
export type InlineKeyboard = InlineButton[][];

interface ApiResult<T> { ok: boolean; result?: T; description?: string }

export class TelegramClient {
  constructor(private readonly token: string, private readonly log: Logger) {}

  private async call<T>(method: string, body: FormData | Record<string, unknown>): Promise<T | null> {
    const url = `https://api.telegram.org/bot${this.token}/${method}`;
    const init: RequestInit = body instanceof FormData
      ? { method: "POST", body }
      : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
    try {
      const res = await fetch(url, init);
      const data = (await res.json()) as ApiResult<T>;
      if (!data.ok) {
        this.log.warn(`telegram ${method} failed`, { status: res.status, description: data.description });
        return null;
      }
      return data.result ?? null;
    } catch (err) {
      this.log.error(`telegram ${method} threw`, err);
      return null;
    }
  }

  sendMessage(chatId: string, text: string, keyboard?: InlineKeyboard): Promise<{ message_id: number } | null> {
    return this.call("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined });
  }

  sendPhoto(chatId: string, jpeg: Uint8Array, caption: string, keyboard?: InlineKeyboard): Promise<{ message_id: number } | null> {
    const form = new FormData();
    form.set("chat_id", chatId);
    form.set("caption", caption);
    form.set("parse_mode", "HTML");
    if (keyboard) form.set("reply_markup", JSON.stringify({ inline_keyboard: keyboard }));
    form.set("photo", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "evidence.jpg");
    return this.call("sendPhoto", form);
  }

  /** Removes the inline buttons once an alert is acknowledged. */
  clearKeyboard(chatId: string, messageId: number): Promise<unknown> {
    return this.call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
  }

  answerCallback(callbackQueryId: string, text: string): Promise<unknown> {
    return this.call("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
  }

  setWebhook(url: string, secretToken: string): Promise<unknown> {
    return this.call("setWebhook", { url, secret_token: secretToken, allowed_updates: ["message", "callback_query"] });
  }

  getMe(): Promise<{ username: string } | null> {
    return this.call("getMe", {});
  }
}
