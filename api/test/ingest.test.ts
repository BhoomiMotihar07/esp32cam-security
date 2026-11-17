import { describe, expect, it } from "vitest";
import { call, claimDevice, heartbeat, makeWorld, registerOwner } from "./helpers.js";
import { ingestMessage } from "../src/domain/ingest.js";

describe("device message ingest", () => {
  it("state messages update the view immediately; heartbeats fill in diagnostics", async () => {
    const { svc } = makeWorld();
    const owner = await registerOwner(svc);
    await claimDevice(svc, owner);
    const t0 = Math.floor(Date.now() / 1000);
    await ingestMessage(svc, "cam-01", { kind: "state", state: "EXIT_COUNTDOWN", armSource: "button", countdownEndsAt: t0 + 30, ts: t0 }, t0);
    let v = (await call(svc, "GET", "devices/cam-01", { token: owner })).json;
    expect(v).toMatchObject({ state: "EXIT_COUNTDOWN", armSource: "button", countdownEndsAt: t0 + 30 });
    await ingestMessage(svc, "cam-01", heartbeat("cam-01", t0 + 5, { resetReason: "BROWNOUT", configVersion: 3 }), t0 + 5);
    v = (await call(svc, "GET", "devices/cam-01", { token: owner })).json;
    expect(v).toMatchObject({ state: "ARMED", resetReason: "BROWNOUT", appliedConfigVersion: 3, offline: false });
    expect(v.countdownEndsAt).toBeUndefined();
  });

  it("the transport's device id wins over the body's", async () => {
    const { svc } = makeWorld();
    const t0 = 1_800_000_000;
    await ingestMessage(svc, "cam-01", heartbeat("cam-02", t0), t0);
    expect(await svc.store.getDevice("cam-02")).toBeNull();
    expect((await svc.store.getDevice("cam-01"))?.lastHeartbeatAt).toBe(t0);
  });

  it("snapshot messages expose a read URL to the app", async () => {
    const { svc } = makeWorld();
    const owner = await registerOwner(svc);
    await claimDevice(svc, owner);
    const t0 = 1_800_000_000;
    await ingestMessage(svc, "cam-01", { kind: "snapshot", blob: `cam-01/${t0}-0.jpg`, ts: t0 }, t0);
    const snap = (await call(svc, "GET", "devices/cam-01/snapshot", { token: owner })).json;
    expect(snap.blob).toBe(`cam-01/${t0}-0.jpg`);
    expect(snap.url).toContain("perm=r");
  });
});
