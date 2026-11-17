import { describe, expect, it } from "vitest";
import { call, claimDevice, makeWorld, registerOwner } from "./helpers.js";
import { ingestMessage } from "../src/domain/ingest.js";
import { repeatPendingAlerts } from "../src/domain/alerts.js";

async function linkChat(svc: ReturnType<typeof makeWorld>["svc"], chatId = "42") {
  const owner = (await svc.store.getUserByEmail("owner@example.com"))!;
  await svc.store.putTelegramLink({ type: "telegramLink", id: chatId, householdId: owner.householdId, chatId, userId: owner.id, title: "owner", linkedAt: 0 });
}

describe("alerts: notify, repeat every 30 s, acknowledge", () => {
  it("sends the first alert with photo and buttons, repeats until acked (capped), and ack silences the device", async () => {
    const { svc, telegram, link, blobs } = makeWorld();
    const ownerToken = await registerOwner(svc);
    await claimDevice(svc, ownerToken);
    await linkChat(svc);
    const t0 = 1_800_000_000;
    await blobs.put(`cam-01/${t0}-0.jpg`, new Uint8Array([0xff, 0xd8, 0xff]));

    const res = await ingestMessage(svc, "cam-01", { kind: "event", type: "motion", zone: "door", score: 0.3, photoCount: 1, photos: [`cam-01/${t0}-0.jpg`], ts: t0 }, t0);
    expect(res.accepted).toBe(true);
    expect(telegram.messages).toHaveLength(1);
    expect(telegram.messages[0]).toMatchObject({ chatId: "42", photo: true });
    expect(telegram.messages[0]!.text).toContain("Motion detected");
    expect(telegram.messages[0]!.keyboard![0]!.map((b) => b.callback_data)).toEqual([`ack|cam-01|${t0}-motion`, "disarm|cam-01", "snapshot|cam-01"]);

    expect(await repeatPendingAlerts(svc, t0 + 10)).toBe(0); // too soon
    expect(await repeatPendingAlerts(svc, t0 + 30)).toBe(1);
    expect(telegram.messages.at(-1)!.text).toContain("Reminder 1");
    expect(await repeatPendingAlerts(svc, t0 + 60)).toBe(1);
    expect(await repeatPendingAlerts(svc, t0 + 90)).toBe(1);
    expect(await repeatPendingAlerts(svc, t0 + 120)).toBe(0); // alertMaxRepeats = 3 in tests

    const ack = await call(svc, "POST", `devices/cam-01/events/${t0}-motion/ack`, { token: ownerToken });
    expect(ack.status).toBe(200);
    expect(ack.json.acknowledged).toBe(true);
    expect(ack.json.acknowledgedBy).toBe("owner@example.com");
    expect(link.last()).toMatchObject({ cmd: "ack" });
    expect(telegram.cleared).toHaveLength(4); // original + 3 reminders lose their buttons
    expect(await repeatPendingAlerts(svc, t0 + 1000)).toBe(0);
  });

  it("events from an unclaimed device are stored but nobody is notified", async () => {
    const { svc, telegram } = makeWorld();
    const t0 = 1_800_000_000;
    await ingestMessage(svc, "ghost", { kind: "event", type: "sound", score: 4, photoCount: 0, photos: [], ts: t0 }, t0);
    expect((await svc.store.listEvents("ghost", { limit: 10 })).length).toBe(1);
    expect(telegram.messages).toHaveLength(0);
  });

  it("rejects events whose photos point at another device's folder or have a bad name", async () => {
    const { svc } = makeWorld();
    const t0 = 1_800_000_000;
    expect(await ingestMessage(svc, "cam-01", { kind: "event", type: "motion", score: 1, photoCount: 1, photos: [`cam-02/${t0}-0.jpg`], ts: t0 }, t0)).toMatchObject({ accepted: false });
    expect(await ingestMessage(svc, "cam-01", { kind: "event", type: "motion", score: 1, photoCount: 1, photos: ["../etc/passwd"], ts: t0 }, t0)).toMatchObject({ accepted: false });
    expect(await ingestMessage(svc, "cam-01", { kind: "event", type: "offline", score: 1, photoCount: 0, photos: [], ts: t0 }, t0)).toMatchObject({ accepted: false });
    expect(await ingestMessage(svc, "cam-01", { kind: "heartbeat", ts: t0 }, t0)).toMatchObject({ accepted: false });
  });
});
