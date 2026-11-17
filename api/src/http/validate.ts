/** Small hand-written validators: explicit, dependency free, and easy to defend line by line. */
import { HttpError } from "./respond.js";

export function requireObject(v: unknown, what = "body"): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new HttpError(400, "invalid_body", `${what} must be an object`);
  return v as Record<string, unknown>;
}

export function requireString(o: Record<string, unknown>, key: string, opts: { min?: number; max?: number; pattern?: RegExp } = {}): string {
  const v = o[key];
  if (typeof v !== "string") throw new HttpError(400, "invalid_field", `${key} must be a string`);
  const { min = 1, max = 512, pattern } = opts;
  if (v.length < min || v.length > max) throw new HttpError(400, "invalid_field", `${key} length must be ${min}..${max}`);
  if (pattern && !pattern.test(v)) throw new HttpError(400, "invalid_field", `${key} has an invalid format`);
  return v;
}

export function optionalString(o: Record<string, unknown>, key: string, opts: { max?: number; pattern?: RegExp } = {}): string | undefined {
  if (o[key] === undefined || o[key] === null) return undefined;
  return requireString(o, key, { min: 0, ...opts });
}

export function requireNumber(o: Record<string, unknown>, key: string, min: number, max: number): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
    throw new HttpError(400, "invalid_field", `${key} must be a number in ${min}..${max}`);
  }
  return v;
}

export function requireBoolean(o: Record<string, unknown>, key: string): boolean {
  const v = o[key];
  if (typeof v !== "boolean") throw new HttpError(400, "invalid_field", `${key} must be a boolean`);
  return v;
}

export function requireEnum<T extends string>(o: Record<string, unknown>, key: string, allowed: readonly T[]): T {
  const v = o[key];
  if (typeof v !== "string" || !allowed.includes(v as T)) {
    throw new HttpError(400, "invalid_field", `${key} must be one of ${allowed.join(", ")}`);
  }
  return v as T;
}

export function requireArray(o: Record<string, unknown>, key: string, max = 100): unknown[] {
  const v = o[key];
  if (!Array.isArray(v) || v.length > max) throw new HttpError(400, "invalid_field", `${key} must be an array of at most ${max}`);
  return v;
}
