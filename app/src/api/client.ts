/** Thin fetch wrapper: adds the bearer token, parses JSON, turns API errors into ApiRequestError. */
const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") || "/api";

export class ApiRequestError extends Error {
  constructor(public readonly status: number, public readonly code: string, public readonly detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

let tokenProvider: () => string | null = () => null;
let onUnauthorized: () => void = () => undefined;

export function configureApi(opts: { getToken: () => string | null; onUnauthorized: () => void }): void {
  tokenProvider = opts.getToken;
  onUnauthorized = opts.onUnauthorized;
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = tokenProvider();
  if (token) headers["authorization"] = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${BASE}/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; detail?: string };
    if (res.status === 401 && !path.startsWith("auth/")) onUnauthorized();
    throw new ApiRequestError(res.status, err.error ?? `http_${res.status}`, err.detail);
  }
  return data as T;
}

export const get = <T>(path: string) => api<T>("GET", path);
export const post = <T>(path: string, body?: unknown) => api<T>("POST", path, body);
export const put = <T>(path: string, body?: unknown) => api<T>("PUT", path, body);
export const patch = <T>(path: string, body?: unknown) => api<T>("PATCH", path, body);
export const del = <T>(path: string, body?: unknown) => api<T>("DELETE", path, body);
