/**
 * Photo upload and read URLs. The device authenticates with a per-device key (hash stored
 * on the device doc); the server picks the blob name so a device can only ever write under
 * its own prefix. App users get read URLs only for blobs of devices in their household.
 */
import { TIMING, isValidDeviceId, isValidPhotoBlobName, photoBlobName } from "@esp32cam/shared";
import type { Services } from "../services.js";
import { HttpError } from "../http/respond.js";
import { nowSec, sha256Hex } from "../util.js";
import type { Principal } from "../auth/principal.js";
import { requireHouseholdDevice } from "../auth/principal.js";

export interface UploadGrant { blob: string; url: string; expiresAt: number }

export async function grantUpload(svc: Services, deviceId: string, seqRaw: string | null, presentedKey: string | null): Promise<UploadGrant> {
  if (!isValidDeviceId(deviceId)) throw new HttpError(400, "invalid_device_id");
  const seq = Number(seqRaw);
  if (!Number.isInteger(seq) || seq < 0 || seq > 999) throw new HttpError(400, "invalid_seq", "seq must be an integer 0..999");
  const device = await svc.store.getDevice(deviceId);
  if (!device || !device.householdId || !device.uploadKeyHash) throw new HttpError(403, "device_not_claimed");
  if (!presentedKey || sha256Hex(presentedKey) !== device.uploadKeyHash) throw new HttpError(403, "bad_device_key");
  const blob = photoBlobName(deviceId, nowSec(), seq);
  const signed = await svc.blobs.uploadUrl(blob, TIMING.UPLOAD_SAS_MINUTES);
  return { blob, url: signed.url, expiresAt: signed.expiresAt };
}

export async function readUrlFor(svc: Services, principal: Principal, blob: string) {
  if (!isValidPhotoBlobName(blob)) throw new HttpError(400, "invalid_blob_name");
  const deviceId = blob.slice(0, blob.indexOf("/"));
  await requireHouseholdDevice(principal, deviceId, svc);
  const signed = await svc.blobs.readUrl(blob, TIMING.READ_SAS_MINUTES);
  return { blob, url: signed.url, expiresAt: signed.expiresAt };
}
