import { createHash, randomBytes, randomUUID } from "node:crypto";

export const nowSec = (): number => Math.floor(Date.now() / 1000);

export const newId = (): string => randomUUID();

/** Human-typeable code (no 0/O/1/I) for invites and Telegram linking. */
export function shortCode(length = 8): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[(bytes[i] ?? 0) % alphabet.length];
  return out;
}

export const sha256Hex = (s: string): string => createHash("sha256").update(s).digest("hex");

export interface Logger {
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, err?: unknown): void;
}

export const consoleLogger: Logger = {
  info: (m, d) => console.log(`[info] ${m}`, d === undefined ? "" : JSON.stringify(d)),
  warn: (m, d) => console.warn(`[warn] ${m}`, d === undefined ? "" : JSON.stringify(d)),
  error: (m, e) => console.error(`[error] ${m}`, e instanceof Error ? (e.stack ?? e.message) : e),
};
