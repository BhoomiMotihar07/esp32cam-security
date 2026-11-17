import { describe, expect, it } from "vitest";
import { call, claimDevice, heartbeat, makeWorld, registerOwner } from "./helpers.js";
import { ingestMessage } from "../src/domain/ingest.js";
import { checkOfflineDevices } from "../src/domain/offline.js";

describe("offline detection", () => {
  it("flags a device 3 minutes after its last heartbeat, once, and clears on the next heartbeat", async () => {
    const { svc, telegram } = makeWorld();
    const owner = await registerOwner(svc);
    await claimDevice(svc, owner);
    await svc.store.putTelegramLink({ type: "telegramLink", id: "42", householdId: (await svc.store.getUserByEmail("owner@example.com"))!.householdId, chatId: "42", userId: "u", title: "t", linkedAt: 0 });

    const t0 = 1_800_000_000;
    expect((await ingestMessage(svc, "cam-01", heartbeat("cam-01", t0), t0)).accepted).toBe(true);
    expect(await checkOfflineDevices(svc, t0 + 179)).toEqual([]);
    expect(await checkOfflineDevices(svc, t0 + 181)).toEqual(["cam-01"]);
    expect(await checkOfflineDevices(svc, t0 + 500)).toEqual([]); // not flagged twice

    const view = (await call(svc, "GET", "devices/cam-01", { token: owner })).json;
    expect(view.lastEvent.type).toBe("offline");
    const events = (await call(svc, "GET", "devices/cam-01/events", { token: owner })).json;
    expect(events[0]).toMatchObject({ type: "offline", acknowledged: false });
    expect(telegram.messages.at(-1)?.text).toContain("Device offline");

    await ingestMessage(svc, "cam-01", heartbeat("cam-01", t0 + 600), t0 + 600);
    const after = (await call(svc, "GET", "devices/cam-01/events", { token: owner })).json;
    expect(after[0]).toMatchObject({ type: "offline", acknowledged: true, acknowledgedBy: "system (back online)" });
    expect(telegram.messages.at(-1)?.text).toContain("acknowledged");
    expect(await checkOfflineDevices(svc, t0 + 1000)).toEqual(["cam-01"]); // can be flagged again later
  });

  it("the device view reports offline:true based on heartbeat age, without waiting for the timer", async () => {
    const { svc } = makeWorld();
    const owner = await registerOwner(svc);
    await claimDevice(svc, owner);
    const now = Math.floor(Date.now() / 1000);
    await ingestMessage(svc, "cam-01", heartbeat("cam-01", now - 400), now - 400);
    expect((await call(svc, "GET", "devices/cam-01", { token: owner })).json.offline).toBe(true);
    await ingestMessage(svc, "cam-01", heartbeat("cam-01", now), now);
    expect((await call(svc, "GET", "devices/cam-01", { token: owner })).json.offline).toBe(false);
  });

  it("never flags a device that has not sent a heartbeat yet", async () => {
    const { svc } = makeWorld();
    const owner = await registerOwner(svc);
    await claimDevice(svc, owner);
    expect(await checkOfflineDevices(svc, 2_000_000_000)).toEqual([]);
  });
});
