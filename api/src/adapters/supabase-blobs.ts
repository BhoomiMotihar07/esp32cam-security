/**
 * Evidence photos in a private Supabase Storage bucket.
 * Upload: createSignedUploadUrl → the device PUTs the JPEG to that URL. The token in the URL is
 *   bound to one object path and cannot overwrite it; Supabase fixes its lifetime at 2 hours
 *   (not configurable, unlike Azure SAS), which is why expiresAt reports 2 h.
 * Read: createSignedUrl with our own short expiry.
 * The service-role key stays on the server; the device and the app only ever get these URLs.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Blobs, SignedUrl } from "../ports/blobs.js";
import { nowSec } from "../util.js";

const SUPABASE_UPLOAD_URL_TTL_SEC = 2 * 3600;

export class SupabaseBlobs implements Blobs {
  constructor(private readonly db: SupabaseClient, private readonly bucket: string) {}

  async uploadUrl(blobName: string): Promise<SignedUrl> {
    const { data, error } = await this.db.storage.from(this.bucket).createSignedUploadUrl(blobName);
    if (error || !data) throw new Error(`supabase upload url: ${error?.message ?? "no data"}`);
    return { url: data.signedUrl, expiresAt: nowSec() + SUPABASE_UPLOAD_URL_TTL_SEC };
  }

  async readUrl(blobName: string, minutes: number): Promise<SignedUrl> {
    const { data, error } = await this.db.storage.from(this.bucket).createSignedUrl(blobName, minutes * 60);
    if (error || !data) throw new Error(`supabase read url: ${error?.message ?? "no data"}`);
    return { url: data.signedUrl, expiresAt: nowSec() + minutes * 60 };
  }

  async get(blobName: string): Promise<Uint8Array | null> {
    const { data, error } = await this.db.storage.from(this.bucket).download(blobName);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  }

  async exists(blobName: string): Promise<boolean> {
    const slash = blobName.lastIndexOf("/");
    const { data, error } = await this.db.storage.from(this.bucket).list(blobName.slice(0, slash), { search: blobName.slice(slash + 1), limit: 1 });
    return !error && (data?.length ?? 0) > 0;
  }
}
