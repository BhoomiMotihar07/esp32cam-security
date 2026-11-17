/**
 * IoT Hub cloud-to-device messages via the service SDK. The hub queues a message for
 * up to 48 h if the device is offline, which is why every command carries `ts` and the
 * device discards anything older than TIMING.COMMAND_MAX_AGE_SEC. We also set a short
 * message expiry so the hub itself drops stale commands.
 */
// Both SDKs are CommonJS; Node's ESM loader cannot see their named exports, so import the module objects.
import iothub from "azure-iothub";
import iotCommon from "azure-iot-common";

const { Client } = iothub;
const { Message } = iotCommon;
import { TIMING, type DeviceCommand } from "@esp32cam/shared";
import type { DeviceLink } from "../ports/device-link.js";

export class IotHubLink implements DeviceLink {
  private readonly client: InstanceType<typeof Client>;

  constructor(serviceConnectionString: string) {
    this.client = Client.fromConnectionString(serviceConnectionString);
  }

  async sendCommand(deviceId: string, command: DeviceCommand): Promise<void> {
    const message = new Message(JSON.stringify(command));
    message.contentType = "application/json";
    message.contentEncoding = "utf-8";
    message.messageId = command.requestId ?? `${command.cmd}-${command.ts}`;
    message.expiryTimeUtc = Date.now() + TIMING.COMMAND_MAX_AGE_SEC * 1000;
    await this.client.send(deviceId, message);
  }
}
