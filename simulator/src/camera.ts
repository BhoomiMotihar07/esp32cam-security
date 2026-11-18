/**
 * Fake OV2640: renders a small synthetic scene as JPEG with jpeg-js so photo uploads,
 * Telegram and the app's evidence viewer all carry real images. `seed` moves an
 * "intruder" block; `brightness` darkens the scene for night / tamper_dark tests.
 */
import jpeg from "jpeg-js";

export interface Frame { width: number; height: number; jpeg: Uint8Array; meanBrightness: number }

export function renderFrame(opts: { seed: number; brightness: number; label: string; width?: number; height?: number }): Frame {
  const width = opts.width ?? 320;
  const height = opts.height ?? 240;
  const data = Buffer.alloc(width * height * 4);
  let sum = 0;
  const b = Math.max(0, Math.min(1, opts.brightness));
  const boxX = (opts.seed * 37) % (width - 60);
  const boxY = (opts.seed * 53) % (height - 90);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // room: vertical gradient wall, darker floor band, a "door" rectangle on the right
      let r = 120 + (y / height) * 60;
      let g = 110 + (y / height) * 50;
      let bl = 100 + (y / height) * 40;
      if (y > height * 0.75) { r = 70; g = 55; bl = 45; }
      if (x > width * 0.72 && x < width * 0.92 && y > height * 0.15 && y < height * 0.8) { r = 90; g = 60; bl = 40; }
      // intruder block
      if (x >= boxX && x < boxX + 50 && y >= boxY && y < boxY + 80) { r = 30; g = 30; bl = 35; }
      // stamp: a few white tiles whose pattern encodes the label hash (so frames differ visibly)
      const tile = Math.floor(x / 8) + Math.floor(y / 8) * 40;
      if (y < 8 && tile % 7 === hash(opts.label) % 7) { r = g = bl = 250; }
      const noise = (Math.random() - 0.5) * 12;
      const i = (y * width + x) * 4;
      const rr = clamp((r + noise) * b), gg = clamp((g + noise) * b), bb = clamp((bl + noise) * b);
      data[i] = rr; data[i + 1] = gg; data[i + 2] = bb; data[i + 3] = 255;
      sum += (rr + gg + bb) / 3;
    }
  }
  const encoded = jpeg.encode({ data, width, height }, 70);
  return { width, height, jpeg: new Uint8Array(encoded.data), meanBrightness: Math.round(sum / (width * height)) };
}

const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
function hash(s: string): number { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

/**
 * Bridge mode: fetch a real JPEG from an ESP32-CAM running the Arduino CameraWebServer example
 * (GET http://<board>/capture). Lets the app show real photos before this project's firmware is
 * flashed. Detection still comes from the simulator keys; only the pictures are real.
 */
export async function captureFromBoard(baseUrl: string, timeoutMs = 8000): Promise<Uint8Array> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/capture?_=${Date.now()}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`board /capture returned ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("board /capture did not return a JPEG");
  return bytes;
}
