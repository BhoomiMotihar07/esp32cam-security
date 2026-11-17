/**
 * Local-mode Blobs: files under LOCAL_DATA_DIR/blobs, addressed by HMAC-signed URLs.
 * The token binds blob name + permission + expiry, so a write token cannot read and a
 * token for one blob cannot touch another, the same guarantees a real Blob SAS gives.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import type { Blobs, SignedUrl } from "../ports/blobs.js";
import { nowSec } from "../util.js";

export type LocalPerm = "r" | "w";

export class LocalBlobs implements Blobs {
  constructor(
    private readonly dir: string,
    private readonly secret: string,
    private readonly publicApiBase: string,
  ) {}

  private sign(name: string, perm: LocalPerm, exp: number): string {
    return createHmac("sha256", this.secret).update(`${name}|${perm}|${exp}`).digest("base64url");
  }

  private url(name: string, perm: LocalPerm, minutes: number): SignedUrl {
    const exp = nowSec() + minutes * 60;
    const sig = this.sign(name, perm, exp);
    const url = `${this.publicApiBase}/local/blob/${name}?perm=${perm}&exp=${exp}&sig=${sig}`;
    return { url, expiresAt: exp };
  }

  /** Used by the dev server route to accept or refuse a request. */
  verify(name: string, perm: LocalPerm, exp: number, sig: string): boolean {
    if (!Number.isFinite(exp) || exp < nowSec()) return false;
    const expected = Buffer.from(this.sign(name, perm, exp));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  async uploadUrl(blobName: string, minutes: number) { return this.url(blobName, "w", minutes); }
  async readUrl(blobName: string, minutes: number) { return this.url(blobName, "r", minutes); }

  private pathFor(name: string): string {
    const p = normalize(join(this.dir, name));
    if (!p.startsWith(normalize(this.dir))) throw new Error("blob name escapes data dir");
    return p;
  }

  async put(blobName: string, bytes: Uint8Array): Promise<void> {
    const p = this.pathFor(blobName);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
  }

  async get(blobName: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.pathFor(blobName)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async exists(blobName: string): Promise<boolean> {
    try {
      await access(this.pathFor(blobName));
      return true;
    } catch {
      return false;
    }
  }
}
