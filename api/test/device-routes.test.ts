import { describe, expect, it } from "vitest";
import { call, claimDevice, makeWorld, nowSec, registerOwner } from "./helpers.js";
import { LocalLink } from "../src/adapters/local-link.js";

const KEY = { "x-device-key": "dev-upload-key-123" };
const hb = () => ({ kind: "heartbeat", state: "DISARMED", armSource: null, rssi: -60, uptime: 5, resetReason: "POWERON", brightness: 100, ts: nowSec() });

describe("device HTTPS routes (local and Supabase modes)", () => {
  it("refuse unregistered devices and wrong keys", async () => {
    const { svc } = makeWorld();
    expect((await call(svc, "POST", "device/cam-01/telemetry", { body: hb(), headers: KEY })).status).toBe(403);
    const owner = await registerOwner(svc);
    await claimDevice(svc, owner);
    expect((await call(svc, "POST", "device/cam-01/telemetry", { body: hb() })).status).toBe(403);
    expect((await call(svc, "POST", "device/cam-01/telemetry", { body: hb(), headers: { "x-device-key": "nope" } })).status).toBe(403);
    expect((await call(svc, "GET", "device/cam-01/commands", { headers: { "x-device-key": "nope" } })).status).toBe(403);
    expect((await call(svc, "POST", "device/bad id!/telemetry", { body: hb(), headers: KEY })).status).toBe(400);
  });

  it("accept telemetry with the right key and deliver queued commands once", async () => {
    const link = new LocalLink();
    const { svc } = makeWorld();
    svc.link = link;
    const owner = await registerOwner(svc);
    await claimDevice(svc, owner);

    const res = await call(svc, "POST", "device/cam-01/telemetry", { body: hb(), headers: KEY });
    expect(res.status).toBe(202);
    expect((await call(svc, "GET", "devices/cam-01", { token: owner })).json.offline).toBe(false);

    await call(svc, "POST", "devices/cam-01/commands", { token: owner, body: { cmd: "snapshot" } });
    const first = await call(svc, "GET", "device/cam-01/commands?wait=0", { headers: KEY });
    expect(first.json).toEqual([expect.objectContaining({ cmd: "snapshot" })]);
    expect((await call(svc, "GET", "device/cam-01/commands?wait=0", { headers: KEY })).json).toEqual([]);
  });

  it("reject malformed telemetry with 400 after authenticating", async () => {
    const { svc } = makeWorld();
    const owner = await registerOwner(svc);
    await claimDevice(svc, owner);
    expect((await call(svc, "POST", "device/cam-01/telemetry", { body: { kind: "heartbeat" }, headers: KEY })).status).toBe(400);
  });
});
