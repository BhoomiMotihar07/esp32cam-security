/**
 * Azure Blob Storage adapter. SAS URLs are signed in-process with the account key
 * (from the connection string); the key never leaves the Function App.
 * Upload SAS: permissions "cw" (create + write), one blob, 5 minutes.
 * Read SAS:   permission "r", one blob, 15 minutes.
 */
import {
  BlobSASPermissions, BlobServiceClient, StorageSharedKeyCredential, generateBlobSASQueryParameters,
} from "@azure/storage-blob";
import type { Blobs, SignedUrl } from "../ports/blobs.js";

function parseConnectionString(cs: string): { accountName: string; accountKey: string; endpointSuffix: string } {
  const parts = Object.fromEntries(cs.split(";").filter(Boolean).map((kv) => { const i = kv.indexOf("="); return [kv.slice(0, i), kv.slice(i + 1)]; }));
  const accountName = parts["AccountName"];
  const accountKey = parts["AccountKey"];
  if (!accountName || !accountKey) throw new Error("STORAGE_CONNECTION_STRING must contain AccountName and AccountKey");
  return { accountName, accountKey, endpointSuffix: parts["EndpointSuffix"] ?? "core.windows.net" };
}

export class AzureBlobs implements Blobs {
  private readonly credential: StorageSharedKeyCredential;
  private readonly service: BlobServiceClient;

  constructor(connectionString: string, private readonly container: string) {
    const { accountName, accountKey, endpointSuffix } = parseConnectionString(connectionString);
    this.credential = new StorageSharedKeyCredential(accountName, accountKey);
    this.service = new BlobServiceClient(`https://${accountName}.blob.${endpointSuffix}`, this.credential);
  }

  async ensureContainer(): Promise<void> {
    await this.service.getContainerClient(this.container).createIfNotExists(); // private by default
  }

  private signed(blobName: string, permissions: string, minutes: number): SignedUrl {
    const expiresOn = new Date(Date.now() + minutes * 60_000);
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.container,
        blobName,
        permissions: BlobSASPermissions.parse(permissions),
        startsOn: new Date(Date.now() - 5 * 60_000), // clock skew on the device
        expiresOn,
        contentType: permissions.includes("r") ? "image/jpeg" : undefined,
      },
      this.credential,
    ).toString();
    const blobUrl = this.service.getContainerClient(this.container).getBlockBlobClient(blobName).url;
    return { url: `${blobUrl}?${sas}`, expiresAt: Math.floor(expiresOn.getTime() / 1000) };
  }

  async uploadUrl(blobName: string, minutes: number) { return this.signed(blobName, "cw", minutes); }
  async readUrl(blobName: string, minutes: number) { return this.signed(blobName, "r", minutes); }

  async get(blobName: string): Promise<Uint8Array | null> {
    const client = this.service.getContainerClient(this.container).getBlockBlobClient(blobName);
    try {
      return new Uint8Array(await client.downloadToBuffer());
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 404) return null;
      throw err;
    }
  }

  async exists(blobName: string): Promise<boolean> {
    return this.service.getContainerClient(this.container).getBlockBlobClient(blobName).exists();
  }
}
