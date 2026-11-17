import { describe, expect, it } from "vitest";
import { call, claimDevice, makeWorld, registerOwner } from "./helpers.js";
import { AzureBlobs } from "../src/adapters/azure-blobs.js";

describe("upload-url and photo-url scope", () => {
  it("requires a claimed device and the right device key", async () => {
    const { svc } = makeWorld();
    expect((await call(svc, "GET", "upload-url?deviceId=cam-01&seq=0", { headers: { "x-device-key": "dev-upload-key-123" } })).status).toBe(403);
    const owner = await registerOwner(svc);
    await claimDevice(svc, owner);
    expect((await call(svc, "GET", "upload-url?deviceId=cam-01&seq=0")).status).toBe(403);
    expect((await call(svc, "GET", "upload-url?deviceId=cam-01&seq=0", { headers: { "x-device-key": "wrong" } })).status).toBe(403);
    expect((await call(svc, "GET", "upload-url?deviceId=cam-01&seq=abc", { headers: { "x-device-key": "dev-upload-key-123" } })).status).toBe(400);
    const ok = await call(svc, "GET", "upload-url?deviceId=cam-01&seq=2", { headers: { "x-device-key": "dev-upload-key-123" } });
    expect(ok.status).toBe(200);
    expect(ok.json.blob).toMatch(/^cam-01\/\d+-2\.jpg$/);
    expect(ok.json.expiresAt - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(5 * 60);
  });

  it("local write token is bound to one blob and one permission", async () => {
    const { svc, blobs } = makeWorld();
    const owner = await registerOwner(svc);
    await claimDevice(svc, owner);
    const grant = (await call(svc, "GET", "upload-url?deviceId=cam-01&seq=0", { headers: { "x-device-key": "dev-upload-key-123" } })).json;
    const url = new URL(grant.url);
    const name = url.pathname.replace(/^\/api\/local\/blob\//, "");
    const exp = Number(url.searchParams.get("exp"));
    const sig = url.searchParams.get("sig")!;
    expect(blobs.verify(name, "w", exp, sig)).toBe(true);
    expect(blobs.verify(name, "r", exp, sig)).toBe(false); // write token cannot read
    expect(blobs.verify("cam-01/1-9.jpg", "w", exp, sig)).toBe(false); // other blob
    expect(blobs.verify(name, "w", exp + 1, sig)).toBe(false); // tampered expiry
    expect(blobs.verify(name, "w", Math.floor(Date.now() / 1000) - 10, sig)).toBe(false); // expired
  });

  it("app users only get read URLs for their own household's devices", async () => {
    const { svc } = makeWorld();
    const owner = await registerOwner(svc);
    await claimDevice(svc, owner);
    const other = await registerOwner(svc, "other@example.com");
    expect((await call(svc, "GET", "photos/url?blob=cam-01/1700000000-0.jpg", { token: owner })).status).toBe(200);
    expect((await call(svc, "GET", "photos/url?blob=cam-01/1700000000-0.jpg", { token: other })).status).toBe(404);
    expect((await call(svc, "GET", "photos/url?blob=../secrets", { token: owner })).status).toBe(400);
  });

  it("Azure SAS is write-only (cw) for uploads and read-only for views, scoped to one blob", () => {
    const fakeKey = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
    const az = new AzureBlobs(`DefaultEndpointsProtocol=https;AccountName=demo;AccountKey=${fakeKey};EndpointSuffix=core.windows.net`, "evidence");
    return Promise.all([az.uploadUrl("cam-01/1-0.jpg", 5), az.readUrl("cam-01/1-0.jpg", 15)]).then(([up, rd]) => {
      const u = new URL(up.url);
      expect(u.pathname).toBe("/evidence/cam-01/1-0.jpg");
      expect(u.searchParams.get("sp")).toBe("cw");
      expect(u.searchParams.get("sr")).toBe("b");
      const r = new URL(rd.url);
      expect(r.searchParams.get("sp")).toBe("r");
      expect(rd.expiresAt - up.expiresAt).toBeGreaterThanOrEqual(9 * 60);
    });
  });
});
