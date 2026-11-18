/**
 * Cloud-to-device commands as rows in public.device_commands. sendCommand inserts; the device's
 * GET /api/device/{id}/commands calls take(), which deletes the device's rows and returns them in
 * one statement, so a command is delivered at most once even if two polls overlap.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeviceCommand } from "@esp32cam/shared";
import type { DeviceLink } from "../ports/device-link.js";

const POLL_STEP_MS = 1000;

export class SupabaseLink implements DeviceLink {
  constructor(private readonly db: SupabaseClient) {}

  async sendCommand(deviceId: string, command: DeviceCommand): Promise<void> {
    const { error } = await this.db.from("device_commands").insert({ device_id: deviceId, command });
    if (error) throw new Error(`supabase sendCommand: ${error.message}`);
  }

  async take(deviceId: string, waitMs: number): Promise<DeviceCommand[]> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const { data, error } = await this.db.from("device_commands").delete().eq("device_id", deviceId).select("id, command");
      if (error) throw new Error(`supabase take: ${error.message}`);
      if (data && data.length > 0) return data.sort((a, b) => a.id - b.id).map((r) => r.command as DeviceCommand);
      if (Date.now() + POLL_STEP_MS > deadline) return [];
      await new Promise((r) => setTimeout(r, POLL_STEP_MS));
    }
  }
}
