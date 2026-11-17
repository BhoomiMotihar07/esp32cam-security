/** Registration, login, households, invites and member management. */
import { ROLES, type Role, type UserView } from "@esp32cam/shared";
import type { HouseholdDoc, InviteDoc, UserDoc } from "../ports/store.js";
import type { Services } from "../services.js";
import { HttpError } from "../http/respond.js";
import { optionalString, requireEnum, requireObject, requireString } from "../http/validate.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { signToken } from "../auth/jwt.js";
import { newId, nowSec, shortCode } from "../util.js";
import type { Principal } from "../auth/principal.js";

const INVITE_TTL_SEC = 7 * 24 * 3600;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const toUserView = (u: UserDoc): UserView => ({ id: u.id, email: u.email, householdId: u.householdId, role: u.role });

/**
 * Two ways in: the SETUP_CODE (creates a new household, caller becomes owner) or an invite
 * code (joins that household with the invite's role). There is no open signup.
 */
export async function register(svc: Services, body: unknown): Promise<{ token: string; user: UserDoc }> {
  const o = requireObject(body);
  const email = requireString(o, "email", { max: 120, pattern: EMAIL_RE }).toLowerCase();
  const password = requireString(o, "password", { min: 8, max: 128 });
  const inviteCode = optionalString(o, "inviteCode", { max: 32 })?.toUpperCase();
  const setupCode = optionalString(o, "setupCode", { max: 128 });
  const householdName = optionalString(o, "householdName", { max: 60 });

  if (await svc.store.getUserByEmail(email)) throw new HttpError(409, "email_taken");
  const now = nowSec();
  const user: UserDoc = { type: "user", id: newId(), householdId: "", email, passwordHash: await hashPassword(password), role: "viewer", createdAt: now };

  if (inviteCode) {
    const invite = await svc.store.getInvite(inviteCode);
    if (!invite || invite.usedBy || invite.expiresAt < now) throw new HttpError(400, "invalid_invite");
    user.householdId = invite.householdId;
    user.role = invite.role;
    await svc.store.putUser(user);
    await svc.store.putInvite({ ...invite, usedBy: user.id, usedAt: now });
  } else if (setupCode && setupCode === svc.config.setupCode) {
    const household: HouseholdDoc = { type: "household", id: newId(), householdId: "", name: householdName ?? "Home", ownerId: user.id, createdAt: now };
    household.householdId = household.id;
    user.householdId = household.id;
    user.role = "owner";
    await svc.store.putHousehold(household);
    await svc.store.putUser(user);
  } else {
    throw new HttpError(400, "invite_or_setup_code_required");
  }
  return { token: await signToken(user.id, svc.config.jwtSecret), user };
}

export async function login(svc: Services, body: unknown): Promise<{ token: string; user: UserDoc }> {
  const o = requireObject(body);
  const email = requireString(o, "email", { max: 120 }).toLowerCase();
  const password = requireString(o, "password", { max: 128 });
  const user = await svc.store.getUserByEmail(email);
  // Same error for unknown email and wrong password so the endpoint does not reveal accounts.
  if (!user || !(await verifyPassword(password, user.passwordHash))) throw new HttpError(401, "invalid_credentials");
  return { token: await signToken(user.id, svc.config.jwtSecret), user };
}

export async function createInvite(svc: Services, p: Principal, body: unknown): Promise<InviteDoc> {
  const role = requireEnum(requireObject(body), "role", ROLES.filter((r) => r !== "owner") as Role[]);
  const now = nowSec();
  const code = shortCode(8);
  const invite: InviteDoc = { type: "invite", id: code, householdId: p.householdId, code, role, createdBy: p.userId, createdAt: now, expiresAt: now + INVITE_TTL_SEC };
  await svc.store.putInvite(invite);
  return invite;
}

export async function changeRole(svc: Services, p: Principal, userId: string, body: unknown): Promise<UserDoc> {
  const role = requireEnum(requireObject(body), "role", ROLES);
  const target = await svc.store.getUser(userId);
  if (!target || target.householdId !== p.householdId) throw new HttpError(404, "member_not_found");
  if (target.id === p.userId && role !== "owner") await assertAnotherOwner(svc, p);
  const updated = { ...target, role };
  await svc.store.putUser(updated);
  return updated;
}

export async function removeMember(svc: Services, p: Principal, userId: string): Promise<void> {
  const target = await svc.store.getUser(userId);
  if (!target || target.householdId !== p.householdId) throw new HttpError(404, "member_not_found");
  if (target.id === p.userId) await assertAnotherOwner(svc, p);
  await svc.store.deleteUser(target.id, target.householdId);
}

/** A household must always keep at least one owner. */
async function assertAnotherOwner(svc: Services, p: Principal): Promise<void> {
  const owners = (await svc.store.listMembers(p.householdId)).filter((m) => m.role === "owner" && m.id !== p.userId);
  if (owners.length === 0) throw new HttpError(400, "last_owner", "promote another member to owner first");
}
