/** Cloud-to-device channel: IoT Hub C2D (Azure), a DB queue (Supabase) or an in-process queue (local). */
import type { DeviceCommand } from "@esp32cam/shared";

export interface DeviceLink {
  sendCommand(deviceId: string, command: DeviceCommand): Promise<void>;
  /**
   * Pull-style delivery for devices that poll over HTTPS (local and Supabase modes). Returns the
   * queued commands, waiting up to waitMs for the first. Absent for IoT Hub, which pushes over MQTT.
   */
  take?(deviceId: string, waitMs: number): Promise<DeviceCommand[]>;
}
