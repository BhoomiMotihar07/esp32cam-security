/**
 * Evidence photo storage port. Azure adapter signs real Blob SAS URLs; the local adapter
 * signs HMAC tokens that the dev server honours on /api/local/blob/{name}.
 * Either way the device never sees a storage key, only a short-lived URL for one blob.
 */
export interface SignedUrl {
  url: string;
  /** epoch seconds */
  expiresAt: number;
}

export interface Blobs {
  /** write-only URL for exactly this blob name, valid for `minutes` */
  uploadUrl(blobName: string, minutes: number): Promise<SignedUrl>;
  /** read-only URL for exactly this blob name */
  readUrl(blobName: string, minutes: number): Promise<SignedUrl>;
  /** bytes of a stored blob (used to forward photos to Telegram); null when missing */
  get(blobName: string): Promise<Uint8Array | null>;
  exists(blobName: string): Promise<boolean>;
}
