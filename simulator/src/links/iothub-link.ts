/** Real IoT Hub over MQTT with the device SDK: telemetry via sendEvent, commands via C2D messages. */
// CommonJS SDKs: import the module objects (named ESM imports are not detectable for these packages).
import iotDevice from "azure-iot-device";
import iotMqtt from "azure-iot-device-mqtt";

const { Client, Message } = iotDevice;
const { Mqtt } = iotMqtt;
type Message = InstanceType<typeof Message>;
import type { DeviceCommand, DeviceMessage } from "@esp32cam/shared";
import type { CloudLink } from "./types.js";

export class IotHubCloudLink implements CloudLink {
  private readonly client: InstanceType<typeof Client>;

  constructor(connectionString: string, private readonly log: (s: string) => void) {
    this.client = Client.fromConnectionString(connectionString, Mqtt);
  }

  async start(onCommand: (cmd: DeviceCommand) => void): Promise<void> {
    await this.client.open();
    this.client.on("message", (msg: Message) => {
      try {
        onCommand(JSON.parse(msg.getData().toString()) as DeviceCommand);
        this.client.complete(msg, () => undefined);
      } catch (err) {
        this.log(`bad C2D message rejected: ${(err as Error).message}`);
        this.client.reject(msg, () => undefined);
      }
    });
    this.client.on("error", (err: Error) => this.log(`iothub error: ${err.message}`));
    this.client.on("disconnect", () => this.log("iothub disconnected; SDK will retry"));
  }

  async publish(message: DeviceMessage): Promise<void> {
    const m = new Message(JSON.stringify(message));
    m.contentType = "application/json";
    m.contentEncoding = "utf-8";
    await this.client.sendEvent(m);
  }

  async stop(): Promise<void> {
    await this.client.close();
  }
}
