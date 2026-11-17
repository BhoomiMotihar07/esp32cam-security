import type { Res } from "./types.js";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200): Res {
  return { status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export function noContent(): Res {
  return { status: 204 };
}

export function errorResponse(err: unknown, log: (msg: string, err?: unknown) => void): Res {
  if (err instanceof HttpError) {
    return json({ error: err.message, detail: err.detail }, err.status);
  }
  log("unhandled error", err);
  return json({ error: "internal_error" }, 500);
}

export function badRequest(message: string, detail?: string): never {
  throw new HttpError(400, message, detail);
}
