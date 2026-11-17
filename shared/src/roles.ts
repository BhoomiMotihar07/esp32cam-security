/** Household roles and what each may do. Checked server-side on every protected route. */
export const ROLES = ["owner", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ACTIONS = [
  "device.view",
  "device.arm",
  "device.disarm",
  "device.snapshot",
  "device.ping",
  "device.config",
  "device.register",
  "event.ack",
  "member.invite",
  "member.manage",
  "telegram.link",
] as const;
export type Action = (typeof ACTIONS)[number];

const MEMBER_ACTIONS: Action[] = ["device.view", "device.arm", "device.disarm", "device.snapshot", "device.ping", "event.ack", "telegram.link"];

const PERMISSIONS: Record<Role, ReadonlySet<Action>> = {
  owner: new Set(ACTIONS),
  member: new Set(MEMBER_ACTIONS),
  viewer: new Set<Action>(["device.view"]),
};

export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[role].has(action);
}
