/** Talks to the API dev server: POST telemetry, long-poll for commands. */
import type { DeviceCommand, DeviceMessage } from "@esp32cam/shared";
import type { CloudLink } from "./types.js";

export class LocalCloudLink implements CloudLink {
  private running = false;

  constructor(private readonly apiBase: string, private readonly deviceId: string, private readonly log: (s: string) => void) {}

  async start(onCommand: (cmd: DeviceCommand) => void): Promise<void> {
    this.running = true;
    void this.pollLoop(onCommand);
  }

  async publish(message: DeviceMessage): Promise<void> {
    const res = await fetch(`${this.apiBase}/local/device/${this.deviceId}/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
    });
    if (!res.ok) throw new Error(`telemetry rejected: ${res.status} ${await res.text()}`);
  }

  private async pollLoop(onCommand: (cmd: DeviceCommand) => void): Promise<void> {
    while (this.running) {
      try {
        const res = await fetch(`${this.apiBase}/local/device/${this.deviceId}/commands?wait=20000`);
        if (!res.ok) throw new Error(`poll ${res.status}`);
        for (const cmd of (await res.json()) as DeviceCommand[]) onCommand(cmd);
      } catch (err) {
        this.log(`command poll failed (${(err as Error).message}); retrying in 3 s`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
  }
}
