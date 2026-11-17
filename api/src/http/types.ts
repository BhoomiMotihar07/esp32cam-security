/**
 * A tiny HTTP abstraction so the same handlers run under the Azure Functions host
 * (functions/register.ts), the local dev server (dev-server.ts) and unit tests.
 */
export interface Req {
  method: string;
  /** path below the /api prefix, no query string */
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  header(name: string): string | null;
  json<T = unknown>(): Promise<T>;
  bytes(): Promise<Uint8Array>;
}

export interface Res {
  status: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

export type Handler = (req: Req) => Promise<Res>;

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface Route {
  name: string;
  method: Method;
  /** Azure Functions route syntax, e.g. "devices/{deviceId}/events" */
  route: string;
  handler: Handler;
  /** local-only routes are never registered with the Functions host */
  localOnly?: boolean;
}
