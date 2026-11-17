import type { DeviceCommand, DeviceMessage } from "@esp32cam/shared";

/** The simulator's view of the cloud: publish telemetry up, receive commands down. */
export interface CloudLink {
  start(onCommand: (cmd: DeviceCommand) => void): Promise<void>;
  publish(message: DeviceMessage): Promise<void>;
  stop(): Promise<void>;
}
