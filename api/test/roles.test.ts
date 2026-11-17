import { describe, expect, it } from "vitest";
import { call, claimDevice, makeWorld, registerOwner, registerWithInvite } from "./helpers.js";

describe("role permissions over the HTTP API", () => {
  it("owner can claim a device; member and viewer cannot", async () => {
    const { svc } = makeWorld();
    const owner = await registerOwner(svc);
    const member = await registerWithInvite(svc, owner, "member", "m@example.com");
    const viewer = await registerWithInvite(svc, owner, "viewer", "v@example.com");
    expect((await call(svc, "POST", "devices", { token: member, body: { deviceId: "x1", name: "x", uploadKey: "12345678" } })).status).toBe(403);
    expect((await call(svc, "POST", "devices", { token: viewer, body: { deviceId: "x1", name: "x", uploadKey: "12345678" } })).status).toBe(403);
    expect((await call(svc, "POST", "devices", { token: owner, body: { deviceId: "x1", name: "x", uploadKey: "12345678" } })).status).toBe(201);
  });

  it("member may arm/disarm/snapshot but not change config; viewer is read-only", async () => {
    const { svc, link } = makeWorld();
    const owner = await registerOwner(svc);
    await claimDevice(svc, owner);
    const member = await registerWithInvite(svc, owner, "member", "m@example.com");
    const viewer = await registerWithInvite(svc, owner, "viewer", "v@example.com");

    expect((await call(svc, "POST", "devices/cam-01/commands", { token: member, body: { cmd: "arm" } })).status).toBe(202);
    expect(link.last()).toMatchObject({ cmd: "arm", source: "app" });
    expect((await call(svc, "POST", "devices/cam-01/commands", { token: viewer, body: { cmd: "arm" } })).status).toBe(403);
    expect((await call(svc, "GET", "devices/cam-01", { token: viewer })).status).toBe(200);

    const cfg = (await call(svc, "GET", "devices/cam-01/config", { token: member })).json.config;
    expect((await call(svc, "PUT", "devices/cam-01/config", { token: member, body: cfg })).status).toBe(403);
    expect((await call(svc, "PUT", "devices/cam-01/config", { token: owner, body: cfg })).status).toBe(200);
    expect(link.last()).toMatchObject({ cmd: "setConfig" });
    expect((link.last() as { config: { version: number } }).config.version).toBe(cfg.version + 1);
  });

  it("members of another household cannot see or command the device", async () => {
    const { svc } = makeWorld();
    const owner = await registerOwner(svc);
    await claimDevice(svc, owner);
    const other = await registerOwner(svc, "other@example.com");
    expect((await call(svc, "GET", "devices/cam-01", { token: other })).status).toBe(404);
    expect((await call(svc, "POST", "devices/cam-01/commands", { token: other, body: { cmd: "disarm" } })).status).toBe(404);
    expect((await call(svc, "GET", "devices", { token: other })).json).toEqual([]);
  });

  it("invites are single-use and roles can be changed, but the last owner cannot demote themselves", async () => {
    const { svc } = makeWorld();
    const owner = await registerOwner(svc);
    const invite = await call(svc, "POST", "household/invites", { token: owner, body: { role: "member" } });
    expect((await call(svc, "POST", "auth/register", { body: { email: "a@example.com", password: "password123", inviteCode: invite.json.code } })).status).toBe(201);
    expect((await call(svc, "POST", "auth/register", { body: { email: "b@example.com", password: "password123", inviteCode: invite.json.code } })).status).toBe(400);
    expect((await call(svc, "POST", "auth/register", { body: { email: "c@example.com", password: "password123" } })).status).toBe(400);

    const me = (await call(svc, "GET", "me", { token: owner })).json;
    expect((await call(svc, "PATCH", `household/members/${me.userId}`, { token: owner, body: { role: "member" } })).status).toBe(400);
    const household = (await call(svc, "GET", "household", { token: owner })).json;
    const a = household.members.find((m: { email: string }) => m.email === "a@example.com");
    expect((await call(svc, "PATCH", `household/members/${a.userId}`, { token: owner, body: { role: "owner" } })).status).toBe(200);
    expect((await call(svc, "PATCH", `household/members/${me.userId}`, { token: owner, body: { role: "member" } })).status).toBe(200);
  });

  it("rejects missing, garbage and revoked tokens", async () => {
    const { svc } = makeWorld();
    const owner = await registerOwner(svc);
    const member = await registerWithInvite(svc, owner, "member", "m@example.com");
    expect((await call(svc, "GET", "devices")).status).toBe(401);
    expect((await call(svc, "GET", "devices", { token: "nope" })).status).toBe(401);
    const household = (await call(svc, "GET", "household", { token: owner })).json;
    const m = household.members.find((x: { email: string }) => x.email === "m@example.com");
    expect((await call(svc, "DELETE", `household/members/${m.userId}`, { token: owner })).status).toBe(204);
    expect((await call(svc, "GET", "devices", { token: member })).status).toBe(401);
  });
});
