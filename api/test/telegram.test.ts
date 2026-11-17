import { describe, expect, it } from "vitest";
import { call, claimDevice, makeWorld, registerOwner, registerWithInvite } from "./helpers.js";
import { handleUpdate } from "../src/domain/telegram-commands.js";

const text = (chatId: number, t: string) => ({ message: { message_id: 1, text: t, chat: { id: chatId, type: "private", first_name: "Rahul" } } });

describe("telegram command authorization", () => {
  it("unlinked chats get nothing but linking instructions", async () => {
    const { svc } = makeWorld();
    const replies = await handleUpdate(svc, text(7, "/arm"));
    expect(replies[0]!.text).toContain("not linked");
  });

  it("links with a valid one-time code, then commands are sent; the code cannot be reused", async () => {
    const { svc, link } = makeWorld();
    const owner = await registerOwner(svc);
    await claimDevice(svc, owner);
    const code = (await call(svc, "POST", "telegram/link-code", { token: owner })).json.code;
    expect((await handleUpdate(svc, text(7, `/link ${code.toLowerCase()}`)))[0]!.text).toContain("Linked");
    expect((await handleUpdate(svc, text(8, `/link ${code}`)))[0]!.text).toContain("invalid");
    expect((await handleUpdate(svc, text(7, "/arm")))[0]!.text).toContain("arm sent");
    expect(link.last()).toMatchObject({ cmd: "arm", source: "telegram" });
    expect((await handleUpdate(svc, text(7, "/status")))[0]!.text).toContain("Hall cam");
    expect((await handleUpdate(svc, text(7, "/snapshot@my_bot")))[0]!.text).toContain("snapshot sent");
  });

  it("a viewer's linked chat is refused for arm/disarm and for the inline buttons", async () => {
    const { svc, link } = makeWorld();
    const owner = await registerOwner(svc);
    await claimDevice(svc, owner);
    const viewer = await registerWithInvite(svc, owner, "viewer", "v@example.com");
    // viewers cannot even mint a link code
    expect((await call(svc, "POST", "telegram/link-code", { token: viewer })).status).toBe(403);
    const v = (await svc.store.getUserByEmail("v@example.com"))!;
    await svc.store.putTelegramLink({ type: "telegramLink", id: "9", householdId: v.householdId, chatId: "9", userId: v.id, title: "v", linkedAt: 0 });

    expect((await handleUpdate(svc, text(9, "/arm")))[0]!.text).toContain("may not arm");
    const cb = await handleUpdate(svc, { callback_query: { id: "cb1", data: "disarm|cam-01", message: { chat: { id: 9 } }, from: { first_name: "V" } } });
    expect(cb[0]!.answerCallback!.text).toContain("may not disarm");
    expect(link.sent).toHaveLength(0);
  });

  it("buttons acknowledge the right event and refuse devices of other households", async () => {
    const { svc, link } = makeWorld();
    const owner = await registerOwner(svc);
    await claimDevice(svc, owner);
    const o = (await svc.store.getUserByEmail("owner@example.com"))!;
    await svc.store.putTelegramLink({ type: "telegramLink", id: "7", householdId: o.householdId, chatId: "7", userId: o.id, title: "o", linkedAt: 0 });
    const t0 = 1_800_000_000;
    await svc.store.putEvent({ id: `${t0}-motion`, deviceId: "cam-01", householdId: o.householdId, type: "motion", score: 1, photoCount: 0, photos: [], ts: t0, receivedAt: t0, alert: { acknowledged: false, repeatCount: 0, lastSentAt: t0, telegramMessages: [] } });

    const ok = await handleUpdate(svc, { callback_query: { id: "cb", data: `ack|cam-01|${t0}-motion`, message: { chat: { id: 7 } }, from: { username: "rahul" } } });
    expect(ok[0]!.answerCallback!.text).toBe("Acknowledged");
    expect((await svc.store.getEvent("cam-01", `${t0}-motion`))!.alert).toMatchObject({ acknowledged: true, acknowledgedBy: "@rahul" });
    expect(link.last()).toMatchObject({ cmd: "ack" });

    const bad = await handleUpdate(svc, { callback_query: { id: "cb2", data: "disarm|cam-99", message: { chat: { id: 7 } }, from: {} } });
    expect(bad[0]!.answerCallback!.text).toBe("Unknown device");
  });

  it("the webhook route rejects requests without the secret header", async () => {
    const { svc } = makeWorld();
    expect((await call(svc, "POST", "telegram/webhook", { body: text(1, "/start") })).status).toBe(401);
    expect((await call(svc, "POST", "telegram/webhook", { body: text(1, "/start"), headers: { "x-telegram-bot-api-secret-token": "hook-secret" } })).status).toBe(200);
  });
});
