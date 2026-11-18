/**
 * Local-mode DeviceLink: a per-device in-memory queue. The simulator long-polls
 * GET /api/device/{id}/commands, which calls `take()`.
 */
import type { DeviceCommand } from "@esp32cam/shared";
import type { DeviceLink } from "../ports/device-link.js";

export class LocalLink implements DeviceLink {
  private queues = new Map<string, DeviceCommand[]>();
  private waiters = new Map<string, Array<() => void>>();

  async sendCommand(deviceId: string, command: DeviceCommand): Promise<void> {
    const q = this.queues.get(deviceId) ?? [];
    q.push(command);
    this.queues.set(deviceId, q);
    for (const wake of this.waiters.get(deviceId) ?? []) wake();
    this.waiters.delete(deviceId);
  }

  /** Returns queued commands, waiting up to `timeoutMs` for the first one. */
  async take(deviceId: string, timeoutMs: number): Promise<DeviceCommand[]> {
    const drain = () => { const q = this.queues.get(deviceId) ?? []; this.queues.set(deviceId, []); return q; };
    if ((this.queues.get(deviceId) ?? []).length > 0) return drain();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      const list = this.waiters.get(deviceId) ?? [];
      list.push(() => { clearTimeout(timer); resolve(); });
      this.waiters.set(deviceId, list);
    });
    return drain();
  }
}
