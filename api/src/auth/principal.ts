/**
 * Resolves the caller from the Authorization header and enforces role permissions.
 * The user document is read on every request so a role change or removal applies at once.
 */
import { can, type Action, type Role } from "@esp32cam/shared";
import type { Req } from "../http/types.js";
import { HttpError } from "../http/respond.js";
import type { Services } from "../services.js";
import { verifyToken } from "./jwt.js";
import type { UserDoc } from "../ports/store.js";

export interface Principal {
  userId: string;
  email: string;
  householdId: string;
  role: Role;
}

export async function requirePrincipal(req: Req, svc: Services): Promise<Principal> {
  const auth = req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) throw new HttpError(401, "unauthorized", "missing bearer token");
  const userId = await verifyToken(token, svc.config.jwtSecret);
  if (!userId) throw new HttpError(401, "unauthorized", "invalid or expired token");
  const user = await svc.store.getUser(userId);
  if (!user) throw new HttpError(401, "unauthorized", "user no longer exists");
  return toPrincipal(user);
}

export function toPrincipal(user: UserDoc): Principal {
  return { userId: user.id, email: user.email, householdId: user.householdId, role: user.role };
}

export function authorize(p: Principal, action: Action): void {
  if (!can(p.role, action)) throw new HttpError(403, "forbidden", `role ${p.role} may not ${action}`);
}

/** Loads a device and checks it belongs to the caller's household. */
export async function requireHouseholdDevice(p: Principal, deviceId: string, svc: Services) {
  const device = await svc.store.getDevice(deviceId);
  if (!device || device.householdId !== p.householdId) throw new HttpError(404, "device_not_found");
  return device;
}
