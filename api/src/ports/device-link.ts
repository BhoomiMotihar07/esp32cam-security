/** Cloud-to-device channel. IoT Hub C2D messages in Azure; an in-process queue in local mode. */
import type { DeviceCommand } from "@esp32cam/shared";

export interface DeviceLink {
  sendCommand(deviceId: string, command: DeviceCommand): Promise<void>;
}
