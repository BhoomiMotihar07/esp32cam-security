/** The photo flow the firmware also follows: ask the API for a write URL, PUT the JPEG, keep the blob name. */
export class Uploader {
  constructor(private readonly apiBase: string, private readonly deviceId: string, private readonly uploadKey: string) {}

  async upload(seq: number, jpeg: Uint8Array): Promise<string> {
    const grantRes = await fetch(`${this.apiBase}/upload-url?deviceId=${encodeURIComponent(this.deviceId)}&seq=${seq}`, {
      headers: { "x-device-key": this.uploadKey },
    });
    if (!grantRes.ok) throw new Error(`upload-url ${grantRes.status}: ${await grantRes.text()}`);
    const grant = (await grantRes.json()) as { blob: string; url: string };

    const put = await fetch(grant.url, {
      method: "PUT",
      headers: { "content-type": "image/jpeg", "x-ms-blob-type": "BlockBlob" }, // x-ms-blob-type is required by Azure, ignored locally
      body: new Uint8Array(jpeg), // fresh copy: fetch wants a Uint8Array backed by a plain ArrayBuffer
    });
    if (!put.ok) throw new Error(`blob PUT ${put.status}: ${await put.text()}`);
    return grant.blob;
  }
}
